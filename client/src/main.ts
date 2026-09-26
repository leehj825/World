import { Client } from '@colyseus/sdk'
import type { GameState, Player } from 'shared'
import {
  CHUNK_SIZE_PX,
  CHUNK_TILES,
  TILE_SIZE,
  TileType,
  chunkFileName,
  isValidChunk,
  worldToChunk,
  type AttackMessage,
  type ChatInput,
  type ChatMessage,
  type CombatEvent,
  type MapChunk,
  type MoveItemMessage,
} from 'shared'
import { SERVER_HTTP_URL } from './api.js'
import { emitChatMessage, emitGameStateChange, emitInventoryChange, onIntent, type InventorySlot } from './EventBus.js'

const SERVER_WS_URL = 'ws://localhost:2567'

const PLAYER_SIZE = 16
const MOVE_STEP = 4
const FLASH_DURATION_MS = 150
const DAMAGE_NUMBER_LIFETIME_MS = 800
const DAMAGE_NUMBER_RISE_PX = 30
const HEALTH_BAR_WIDTH = 24
const HEALTH_BAR_HEIGHT = 4
const HEALTH_BAR_OFFSET_Y = 14

const TILE_COLORS: Record<TileType, string> = {
  [TileType.Water]: '#2b6cb0',
  [TileType.Grass]: '#3f8f4f',
  [TileType.Rock]: '#7a7a7a',
}

const keyToMove: Record<string, { x: number; y: number }> = {
  w: { x: 0, y: -MOVE_STEP },
  a: { x: -MOVE_STEP, y: 0 },
  s: { x: 0, y: MOVE_STEP },
  d: { x: MOVE_STEP, y: 0 },
}

/** Keeps the 3x3 chunk neighborhood around a world position loaded, fetching
 * new chunks as they come into range and dropping ones that fall out. */
class ChunkManager {
  private readonly chunks = new Map<string, MapChunk>()
  private readonly inFlight = new Set<string>()
  private centerChunkX: number | null = null
  private centerChunkY: number | null = null

  private static key(chunkX: number, chunkY: number): string {
    return `${chunkX},${chunkY}`
  }

  private neededKeys(centerChunkX: number, centerChunkY: number): Set<string> {
    const needed = new Set<string>()
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = centerChunkX + dx
        const cy = centerChunkY + dy
        if (isValidChunk(cx, cy)) {
          needed.add(ChunkManager.key(cx, cy))
        }
      }
    }
    return needed
  }

  /** Call whenever the local player's chunk may have changed. No-op if it hasn't. */
  update(worldX: number, worldY: number): void {
    const chunkX = worldToChunk(worldX)
    const chunkY = worldToChunk(worldY)

    if (chunkX === this.centerChunkX && chunkY === this.centerChunkY) {
      return
    }
    this.centerChunkX = chunkX
    this.centerChunkY = chunkY

    const needed = this.neededKeys(chunkX, chunkY)

    // Drop chunks that fell out of range.
    for (const key of this.chunks.keys()) {
      if (!needed.has(key)) {
        this.chunks.delete(key)
      }
    }

    // Fetch chunks that came into range and aren't cached (or already loading).
    for (const key of needed) {
      if (this.chunks.has(key) || this.inFlight.has(key)) continue

      const [cx, cy] = key.split(',').map(Number)
      this.inFlight.add(key)

      fetch(`${SERVER_HTTP_URL}/data/map/${chunkFileName(cx, cy)}`)
        .then((response) => {
          if (!response.ok) throw new Error(`failed to fetch chunk ${key}`)
          return response.json() as Promise<MapChunk>
        })
        .then((chunk) => {
          // The player may have moved away again before this resolved.
          if (this.neededKeys(this.centerChunkX!, this.centerChunkY!).has(key)) {
            this.chunks.set(key, chunk)
          }
        })
        .catch((error) => console.error('chunk load failed', error))
        .finally(() => this.inFlight.delete(key))
    }
  }

  loadedChunks(): IterableIterator<MapChunk> {
    return this.chunks.values()
  }
}

/** Hit-reaction state driven by transient `combat_event` messages, kept
 * separate from authoritative state so it can animate independently of the
 * server's patch rate. */
interface FloatingDamage {
  targetId: string
  damage: number
  x: number
  y: number
  startedAt: number
}

/**
 * Bootstraps the Colyseus connection and starts rendering the game to the
 * given canvas. This is the game engine's only public entry point — it owns
 * no DOM beyond the canvas it's handed, so it can be mounted by anything
 * (a bare HTML page, a React component, whatever).
 */
export async function initGame(canvas: HTMLCanvasElement, token: string): Promise<void> {
  const ctx = canvas.getContext('2d')!
  const chunkManager = new ChunkManager()
  const flashUntil = new Map<string, number>()
  let floatingDamages: FloatingDamage[] = []

  function resizeCanvas() {
    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
  }
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  function drawTerrain(cameraX: number, cameraY: number) {
    for (const chunk of chunkManager.loadedChunks()) {
      const chunkOriginX = chunk.chunkX * CHUNK_SIZE_PX
      const chunkOriginY = chunk.chunkY * CHUNK_SIZE_PX

      for (let localY = 0; localY < CHUNK_TILES; localY++) {
        const row = chunk.tiles[localY]
        for (let localX = 0; localX < CHUNK_TILES; localX++) {
          const screenX = chunkOriginX + localX * TILE_SIZE - cameraX
          const screenY = chunkOriginY + localY * TILE_SIZE - cameraY

          if (screenX + TILE_SIZE < 0 || screenX > canvas.width) continue
          if (screenY + TILE_SIZE < 0 || screenY > canvas.height) continue

          ctx.fillStyle = TILE_COLORS[row[localX]]
          ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE)
        }
      }
    }
  }

  function drawHealthBar(screenX: number, screenY: number, player: Player) {
    const barX = screenX - HEALTH_BAR_WIDTH / 2
    const barY = screenY - HEALTH_BAR_OFFSET_Y
    const ratio = player.maxHp > 0 ? Math.max(0, Math.min(1, player.hp / player.maxHp)) : 0

    ctx.fillStyle = '#3a1010'
    ctx.fillRect(barX, barY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT)
    ctx.fillStyle = '#2ecc40'
    ctx.fillRect(barX, barY, HEALTH_BAR_WIDTH * ratio, HEALTH_BAR_HEIGHT)
  }

  function drawFloatingDamage(now: number, cameraX: number, cameraY: number) {
    floatingDamages = floatingDamages.filter((entry) => now - entry.startedAt < DAMAGE_NUMBER_LIFETIME_MS)

    for (const entry of floatingDamages) {
      const elapsed = now - entry.startedAt
      const progress = elapsed / DAMAGE_NUMBER_LIFETIME_MS

      const screenX = entry.x - cameraX
      const screenY = entry.y - cameraY - PLAYER_SIZE / 2 - progress * DAMAGE_NUMBER_RISE_PX

      ctx.globalAlpha = 1 - progress
      ctx.fillStyle = '#ff4d4d'
      ctx.font = 'bold 14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`-${entry.damage}`, screenX, screenY)
      ctx.globalAlpha = 1
    }
  }

  function draw(state: GameState, sessionId: string) {
    const now = performance.now()
    const localPlayer = state.players.get(sessionId)
    const cameraX = (localPlayer?.x ?? 0) - canvas.width / 2
    const cameraY = (localPlayer?.y ?? 0) - canvas.height / 2

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawTerrain(cameraX, cameraY)

    state.players.forEach((player, id) => {
      const screenX = player.x - cameraX
      const screenY = player.y - cameraY

      const isFlashing = (flashUntil.get(id) ?? 0) > now
      ctx.fillStyle = isFlashing ? '#ff3b3b' : id === sessionId ? '#aa3bff' : '#f3f4f6'
      ctx.fillRect(screenX - PLAYER_SIZE / 2, screenY - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE)

      drawHealthBar(screenX, screenY, player)
    })

    drawFloatingDamage(now, cameraX, cameraY)

    if (localPlayer) {
      chunkManager.update(localPlayer.x, localPlayer.y)
      emitGameStateChange({ hp: localPlayer.hp, maxHp: localPlayer.maxHp, playerCount: state.players.size })

      const slots: InventorySlot[] = []
      localPlayer.inventory.forEach((item, slotIndex) => {
        slots.push({ slotIndex: Number(slotIndex), itemId: item.itemId, quantity: item.quantity })
      })
      emitInventoryChange(slots)
    }
  }

  const client = new Client(SERVER_WS_URL)
  const room = await client.joinOrCreate<GameState>('game_room', { token })

  let latestState: GameState | null = null
  room.onStateChange((state) => {
    latestState = state
  })

  const renderLoop = () => {
    if (latestState) {
      draw(latestState, room.sessionId)
    }
    requestAnimationFrame(renderLoop)
  }
  requestAnimationFrame(renderLoop)

  room.onMessage<CombatEvent>('combat_event', (event) => {
    const now = performance.now()
    flashUntil.set(event.targetId, now + FLASH_DURATION_MS)

    const target = latestState?.players.get(event.targetId)
    floatingDamages.push({
      targetId: event.targetId,
      damage: event.damage,
      x: target?.x ?? 0,
      y: target?.y ?? 0,
      startedAt: now,
    })
  })

  room.onMessage<ChatMessage>('chat_message', (message) => {
    emitChatMessage(message)
  })

  onIntent((intent) => {
    if (intent.type === 'chat') {
      room.send('chat_message', { text: intent.text } satisfies ChatInput)
    } else if (intent.type === 'move_item') {
      room.send('move_item', { fromSlot: intent.fromSlot, toSlot: intent.toSlot } satisfies MoveItemMessage)
    }
  })

  window.addEventListener('keydown', (event) => {
    const move = keyToMove[event.key.toLowerCase()]
    if (!move) return
    room.send('move', move)
  })

  canvas.addEventListener('click', (event) => {
    if (!latestState) return

    const localPlayer = latestState.players.get(room.sessionId)
    const cameraX = (localPlayer?.x ?? 0) - canvas.width / 2
    const cameraY = (localPlayer?.y ?? 0) - canvas.height / 2

    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left + cameraX
    const clickY = event.clientY - rect.top + cameraY

    latestState.players.forEach((player, id) => {
      if (id === room.sessionId) return

      const withinX = Math.abs(clickX - player.x) <= PLAYER_SIZE / 2
      const withinY = Math.abs(clickY - player.y) <= PLAYER_SIZE / 2
      if (withinX && withinY) {
        room.send('attack', { targetId: id } satisfies AttackMessage)
      }
    })
  })
}
