import { useEffect, useState } from 'react'
import { onGameStateChange, type GameStateSnapshot } from 'client'

function HudBar() {
  const [snapshot, setSnapshot] = useState<GameStateSnapshot | null>(null)

  useEffect(() => onGameStateChange(setSnapshot), [])

  if (!snapshot) return null

  return (
    <div className="hud-bar">
      HP {snapshot.hp} / {snapshot.maxHp} &middot; {snapshot.playerCount} nearby
    </div>
  )
}

export default HudBar
