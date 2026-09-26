import './style.css'
import { Client } from '@colyseus/sdk'
import type { GameState } from 'shared'
import {
  CHUNK_SIZE_PX,
  CHUNK_TILES,
  TILE_SIZE,
  TileType,
  chunkFileName,
  isValidChunk,
  worldToChunk,
  type MapChunk,
} from 'shared'

const SERVER_HTTP_URL = 'http://localhost:2567'
const SERVER_WS_URL = 'ws://localhost:2567'

const app = document.querySelector<HTMLDivElement>('#app')!

const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 600
app.appendChild(canvas)

const ctx = canvas.getContext('2d')!

const authOverlay = document.createElement('div')
authOverlay.className = 'auth-overlay'
authOverlay.innerHTML = `
  <form class="auth-form">
    <h1>Vanguard RPG</h1>
    <label>
      Username
      <input type="text" name="username" autocomplete="username" required />
    </label>
    <label>
      Password
      <input type="password" name="password" autocomplete="current-password" required />
    </label>
    <div class="auth-actions">
      <button type="submit" data-action="login">Login</button>
      <button type="button" data-action="register">Register</button>
    </div>
    <p class="auth-error"></p>
  </form>
`
app.appendChild(authOverlay)

const authForm = authOverlay.querySelector('form')!
const usernameInput = authForm.querySelector<HTMLInputElement>('input[name="username"]')!
const passwordInput = authForm.querySelector<HTMLInputElement>('input[name="password"]')!
const registerButton = authForm.querySelector<HTMLButtonElement>('[data-action="register"]')!
const errorMessage = authForm.querySelector<HTMLParagraphElement>('.auth-error')!

const PLAYER_SIZE = 16
const MOVE_STEP = 4

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

const chunkManager = new ChunkManager()

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

function draw(state: GameState, sessionId: string) {
  const localPlayer = state.players.get(sessionId)
  const cameraX = (localPlayer?.x ?? 0) - canvas.width / 2
  const cameraY = (localPlayer?.y ?? 0) - canvas.height / 2

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawTerrain(cameraX, cameraY)

  state.players.forEach((player, id) => {
    ctx.fillStyle = id === sessionId ? '#aa3bff' : '#f3f4f6'
    ctx.fillRect(
      player.x - cameraX - PLAYER_SIZE / 2,
      player.y - cameraY - PLAYER_SIZE / 2,
      PLAYER_SIZE,
      PLAYER_SIZE,
    )
  })

  if (localPlayer) {
    chunkManager.update(localPlayer.x, localPlayer.y)
  }
}

async function callAuthEndpoint(path: '/auth/login' | '/auth/register', username: string, password: string) {
  const response = await fetch(`${SERVER_HTTP_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error ?? 'request failed')
  }

  return body
}

async function connectToGameRoom(token: string) {
  const client = new Client(SERVER_WS_URL)
  const room = await client.joinOrCreate<GameState>('game_room', { token })

  authOverlay.remove()

  room.onStateChange((state) => {
    draw(state, room.sessionId)
  })

  window.addEventListener('keydown', (event) => {
    const move = keyToMove[event.key.toLowerCase()]
    if (!move) return
    room.send('move', move)
  })
}

async function handleAuth(path: '/auth/login' | '/auth/register') {
  errorMessage.textContent = ''

  const username = usernameInput.value.trim()
  const password = passwordInput.value

  try {
    if (path === '/auth/register') {
      await callAuthEndpoint('/auth/register', username, password)
    }

    const { token } = await callAuthEndpoint('/auth/login', username, password)
    await connectToGameRoom(token)
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : 'something went wrong'
  }
}

authForm.addEventListener('submit', (event) => {
  event.preventDefault()
  handleAuth('/auth/login')
})

registerButton.addEventListener('click', () => {
  handleAuth('/auth/register')
})
