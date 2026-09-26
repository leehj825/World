import { useState } from 'react'
import { login, register } from 'client'

interface LoginFormProps {
  onSuccess: (token: string) => void
}

function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleAuth(action: 'login' | 'register') {
    setError('')

    try {
      if (action === 'register') {
        await register(username.trim(), password)
      }

      const token = await login(username.trim(), password)
      onSuccess(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong')
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault()
        handleAuth('login')
      }}
    >
      <h1>Vanguard RPG</h1>
      <label>
        Username
        <input
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="auth-actions">
        <button type="submit">Login</button>
        <button type="button" onClick={() => handleAuth('register')}>
          Register
        </button>
      </div>
      <p className="auth-error">{error}</p>
    </form>
  )
}

export default LoginForm
