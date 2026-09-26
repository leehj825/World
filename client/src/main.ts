import './style.css'
import { Client } from '@colyseus/sdk'
import type { GameState } from 'shared'

const app = document.querySelector<HTMLDivElement>('#app')!

const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 600
app.appendChild(canvas)

const ctx = canvas.getContext('2d')!

const PLAYER_SIZE = 16
const MOVE_STEP = 4

const client = new Client('ws://localhost:2567')

const keyToMove: Record<string, { x: number; y: number }> = {
  w: { x: 0, y: -MOVE_STEP },
  a: { x: -MOVE_STEP, y: 0 },
  s: { x: 0, y: MOVE_STEP },
  d: { x: MOVE_STEP, y: 0 },
}

function draw(state: GameState, sessionId: string) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  state.players.forEach((player, id) => {
    ctx.fillStyle = id === sessionId ? '#aa3bff' : '#6b6375'
    ctx.fillRect(
      player.x - PLAYER_SIZE / 2,
      player.y - PLAYER_SIZE / 2,
      PLAYER_SIZE,
      PLAYER_SIZE,
    )
  })
}

async function main() {
  const room = await client.joinOrCreate<GameState>('game_room')

  room.onStateChange((state) => {
    draw(state, room.sessionId)
  })

  window.addEventListener('keydown', (event) => {
    const move = keyToMove[event.key.toLowerCase()]
    if (!move) return
    room.send('move', move)
  })
}

main().catch((error) => {
  console.error('Failed to connect to game server', error)
})
