/** Client -> server: attack another player by session ID. */
export interface AttackMessage {
  targetId: string;
}

/** Server -> clients: a transient, non-authoritative notice for hit reactions
 * (flash, floating damage numbers). The authoritative hp lives in state; this
 * is only for instantaneous feedback that shouldn't wait for a state patch. */
export interface CombatEvent {
  targetId: string;
  damage: number;
}

/** Client -> server: a chat message to broadcast. The sender is never taken
 * from the client — the server fills it in from the authenticated character. */
export interface ChatInput {
  text: string;
}

/** Server -> clients: a chat message, with the server-resolved sender name. */
export interface ChatMessage {
  sender: string;
  text: string;
}

/** Client -> server: swap the items (if any) between two inventory slots. */
export interface MoveItemMessage {
  fromSlot: number;
  toSlot: number;
}
