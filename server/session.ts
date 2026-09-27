/**
 * The full snapshot GameRoom needs to spawn a player, packed into the JWT at
 * /auth/login time instead of being looked up again in onJoin.
 *
 * Why: onJoin previously ran `prisma.character.findFirst({ include:
 * { inventoryItems: true } })` for every single connecting client, inside
 * Colyseus's seat-reservation window. Under a burst of simultaneous joins
 * (a load-test wave, or a real launch-day login spike), those queries queue
 * up behind Prisma's connection pool, seat reservations expire before the
 * query returns, and the client's join fails outright — this showed up
 * directly in the Phase 6 stress test as "seat reservation expired" once
 * connections passed ~1000. Login already does one Account lookup; this
 * just asks it to include the Character + inventory in that same query
 * (no extra DB round trip versus before) and hands the result to the room
 * via a value the room only ever needs to verify a signature on, not query
 * a database for.
 *
 * Trust model: the JWT is signed with JWT_SECRET, so nothing here is more
 * trusted than accountId already was — a client can't forge or edit this
 * payload without invalidating the signature.
 *
 * Trade-off: this is a snapshot taken at login time, not a live read. If a
 * character's row changed between login and join, onJoin would spawn from
 * the stale snapshot. In this system nothing writes to a Character row
 * except that same character's own connected session (StateSyncService),
 * so in the normal flow (login immediately followed by join, which is how
 * both the client and the load-test bots operate) there's no window for
 * staleness. The one real edge case: the same account logging in twice
 * (e.g. two browser tabs) and joining with the older token after the newer
 * session has already moved — that session would spawn from outdated
 * position/inventory data. Not a data-integrity issue (whichever session is
 * actually connected still owns writing the authoritative state), just a
 * possibly-surprising spawn point in an already-unsupported multi-session
 * scenario.
 */
export interface SessionTokenPayload {
  accountId: string;
  characterId: string;
  characterName: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attackPower: number;
  inventory: Array<{ slotIndex: number; itemId: string; quantity: number }>;
}

export function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;

  return (
    typeof payload.accountId === 'string' &&
    typeof payload.characterId === 'string' &&
    typeof payload.characterName === 'string' &&
    typeof payload.x === 'number' &&
    typeof payload.y === 'number' &&
    typeof payload.hp === 'number' &&
    typeof payload.maxHp === 'number' &&
    typeof payload.attackPower === 'number' &&
    Array.isArray(payload.inventory) &&
    payload.inventory.every(
      (item): item is SessionTokenPayload['inventory'][number] =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).slotIndex === 'number' &&
        typeof (item as Record<string, unknown>).itemId === 'string' &&
        typeof (item as Record<string, unknown>).quantity === 'number',
    )
  );
}
