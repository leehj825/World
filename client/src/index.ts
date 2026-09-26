export { initGame } from './main.js'
export { login, register } from './api.js'
export {
  emitIntent,
  onGameStateChange,
  onChatMessage,
  onInventoryChange,
  type GameStateSnapshot,
  type Intent,
  type InventorySlot,
} from './EventBus.js'
export type { ChatMessage } from 'shared'
