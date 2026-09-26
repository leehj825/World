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
