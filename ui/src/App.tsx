import { useEffect, useRef, useState } from 'react'
import { initGame } from 'client'
import LoginForm from './components/LoginForm.tsx'
import ChatBox from './components/ChatBox.tsx'
import HudBar from './components/HudBar.tsx'
import InventoryGrid from './components/InventoryGrid.tsx'
import './App.css'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [token, setToken] = useState<string | null>(null)
  const [connectError, setConnectError] = useState('')

  useEffect(() => {
    if (!token || !canvasRef.current) return

    initGame(canvasRef.current, token).catch((error) => {
      setConnectError(error instanceof Error ? error.message : 'failed to connect')
    })
  }, [token])

  return (
    <div className="app-root">
      <canvas ref={canvasRef} className="game-canvas" />

      <div className="overlay">
        {!token && (
          <div className="overlay-centered">
            <LoginForm onSuccess={setToken} />
            {connectError && <p className="auth-error">{connectError}</p>}
          </div>
        )}

        {token && (
          <>
            <HudBar />
            <ChatBox />
            <InventoryGrid />
          </>
        )}
      </div>
    </div>
  )
}

export default App
