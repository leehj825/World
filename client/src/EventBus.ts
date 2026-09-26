import type { ChatMessage } from 'shared'

/**
 * Zero-dependency pub/sub bridging the game canvas and the React overlay.
 * Built on native `window` CustomEvents so neither side needs to import the
 * other directly — `client` (this module) is the only thing both sides
 * share.
 */
const EVENT_PREFIX = 'vanguard:'

function emit<T>(name: string, detail: T): void {
  window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${name}`, { detail }))
}

function subscribe<T>(name: string, handler: (detail: T) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<T>).detail)
  window.addEventListener(`${EVENT_PREFIX}${name}`, listener)
  return () => window.removeEventListener(`${EVENT_PREFIX}${name}`, listener)
}

/** A compact snapshot of the local player, re-emitted whenever the game
 * engine draws a frame — cheap enough for a HUD to read every tick. */
export interface GameStateSnapshot {
  hp: number
  maxHp: number
  playerCount: number
}

export function emitGameStateChange(snapshot: GameStateSnapshot): void {
  emit('game_state_change', snapshot)
}

/** One occupied inventory slot, as displayed by the UI. */
export interface InventorySlot {
  slotIndex: number
  itemId: string
  quantity: number
}

export function emitInventoryChange(slots: InventorySlot[]): void {
  emit('inventory_change', slots)
}

export function onInventoryChange(handler: (slots: InventorySlot[]) => void): () => void {
  return subscribe('inventory_change', handler)
}

/** React -> game engine: an intent for the engine to carry out. */
export type Intent = { type: 'chat'; text: string } | { type: 'move_item'; fromSlot: number; toSlot: number }

export function emitIntent(intent: Intent): void {
  emit('intent', intent)
}

export function onIntent(handler: (intent: Intent) => void): () => void {
  return subscribe('intent', handler)
}

export function onGameStateChange(handler: (snapshot: GameStateSnapshot) => void): () => void {
  return subscribe('game_state_change', handler)
}

export function emitChatMessage(message: ChatMessage): void {
  emit('chat_message', message)
}

export function onChatMessage(handler: (message: ChatMessage) => void): () => void {
  return subscribe('chat_message', handler)
}
