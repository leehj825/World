import './style.css'
import { setupCounter } from './counter.ts'

const app = document.querySelector<HTMLDivElement>('#app')!
app.textContent = "Vanguard-RPG Client Initialized"

const button = document.createElement('button')
button.id = 'counter'
button.className = 'counter'
app.appendChild(button)

setupCounter(button)
