import './style.css'
import { Client } from '@colyseus/sdk'
import type { GameState } from 'shared'

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
