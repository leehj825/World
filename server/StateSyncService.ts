import { prisma } from 'database';

/** Past this, a single flush is eating nearly half the 7s interval between
 * flushes — a critical capacity signal that Postgres (or the size of the
 * dirty set) can't keep up, not just a soft warning. */
const DB_FLUSH_CRITICAL_THRESHOLD_MS = 3000;

interface PendingCharacterState {
  x: number;
  y: number;
  hp: number;
}

export interface PendingInventorySlot {
  slotIndex: number;
  itemId: string;
  quantity: number;
}

/**
 * Write-behind cache for Character position/hp and inventory contents.
 * `move`/`attack`/`move_item` handlers only ever touch the in-memory dirty
 * maps (synchronous, cheap); the actual Postgres write happens on a timer so
 * the game loop is never blocked on I/O.
 *
 * Concurrency: every DB write — periodic batch flushes and the one-off
 * `saveNow()` used on disconnect — runs through a single FIFO `writeQueue`
 * promise chain. Deciding *what* to write (snapshotting/clearing the dirty
 * maps) always happens synchronously before a job is enqueued, so there's no
 * window where two writes could be built from inconsistent data, and
 * because the queue is strictly FIFO, a write can never be applied out of
 * the order it was enqueued in — a stale flush can't clobber a fresher
 * disconnect-save, or vice versa. See `saveNow()` for the exact interleaving
 * with a concurrent flush.
 */
export class StateSyncService {
  private dirty = new Map<string, PendingCharacterState>();
  private dirtyInventories = new Map<string, PendingInventorySlot[]>();
  private writeQueue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly flushIntervalMs = 7000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((error) => {
        console.error('[StateSyncService] periodic flush failed', error);
      });
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Called from the `move`/`attack` handlers. Cheap, synchronous, never touches the DB. */
  markDirty(characterId: string, x: number, y: number, hp: number): void {
    this.dirty.set(characterId, { x, y, hp });
  }

  /**
   * Called from the `move_item` handler with the character's FULL current
   * inventory (every occupied slot), not a diff — the persist step rewrites
   * the whole set for that character, so a partial snapshot would silently
   * drop items that weren't touched by the move that triggered this call.
   */
  markInventoryDirty(characterId: string, slots: PendingInventorySlot[]): void {
    this.dirtyInventories.set(characterId, slots);
  }

  /**
   * Snapshot everything currently dirty (positions and inventories alike)
   * and hand it to the write queue as one job. The snapshot+clear is
   * synchronous, so any `markDirty`/`markInventoryDirty` calls that happen
   * while the batch is in flight land in fresh maps rather than being lost
   * or racing the write.
   */
  flush(): Promise<void> {
    if (this.dirty.size === 0 && this.dirtyInventories.size === 0) return this.writeQueue;

    const characters = this.dirty;
    const inventories = this.dirtyInventories;
    this.dirty = new Map();
    this.dirtyInventories = new Map();

    return this.enqueue(characters, inventories, 'db-flush');
  }

  /**
   * Force an immediate save of one character's position AND inventory —
   * used on disconnect so nothing pending is lost if it lands between
   * periodic flushes.
   *
   * If a periodic flush already snapshotted this character (took it out of
   * the dirty maps) but hasn't finished writing yet, the `.get()`s below
   * return nothing: there's nothing fresher to save, and awaiting
   * `writeQueue` ensures we still don't return until that in-flight write
   * (which already has this character's latest data) has landed.
   */
  saveNow(characterId: string): Promise<void> {
    const character = this.dirty.get(characterId);
    const inventory = this.dirtyInventories.get(characterId);
    if (!character && !inventory) return this.writeQueue;

    this.dirty.delete(characterId);
    this.dirtyInventories.delete(characterId);

    return this.enqueue(
      character ? new Map([[characterId, character]]) : new Map(),
      inventory ? new Map([[characterId, inventory]]) : new Map(),
      'db-save',
    );
  }

  private enqueue(
    characters: Map<string, PendingCharacterState>,
    inventories: Map<string, PendingInventorySlot[]>,
    label: string,
  ): Promise<void> {
    this.writeQueue = this.writeQueue.then(
      () => this.persist(characters, inventories, label),
      () => this.persist(characters, inventories, label), // keep the queue alive even if a prior job rejected
    );
    return this.writeQueue;
  }

  private async persist(
    characters: Map<string, PendingCharacterState>,
    inventories: Map<string, PendingInventorySlot[]>,
    label: string,
  ): Promise<void> {
    if (characters.size === 0 && inventories.size === 0) return;

    // Measures exactly how long the batch write to Postgres takes, so we
    // can tell whether the write-behind queue keeps up as the dirty set
    // grows (e.g. 50+ characters under load-test load) without ever
    // blocking the room's own message handling — this timer runs on the
    // FIFO writeQueue, never inline with a game-loop tick.
    const start = performance.now();
    try {
      await prisma.$transaction([
        ...Array.from(characters, ([characterId, { x, y, hp }]) =>
          prisma.character.update({ where: { id: characterId }, data: { x, y, hp } }),
        ),
        // Inventory has one row per item, not one row per character, so a
        // "move" can't be expressed as a single UPDATE like position/hp can.
        // Simplest correct approach: replace the character's whole slot set
        // with the current in-memory snapshot.
        ...Array.from(inventories, ([characterId, slots]) => [
          prisma.inventoryItem.deleteMany({ where: { characterId } }),
          ...(slots.length > 0
            ? [
                prisma.inventoryItem.createMany({
                  data: slots.map((slot) => ({ characterId, ...slot })),
                }),
              ]
            : []),
        ]).flat(),
      ]);
    } catch (error) {
      // Put failed writes back so the next flush retries them, but never
      // clobber a value that changed again in the meantime.
      for (const [characterId, position] of characters) {
        if (!this.dirty.has(characterId)) {
          this.dirty.set(characterId, position);
        }
      }
      for (const [characterId, slots] of inventories) {
        if (!this.dirtyInventories.has(characterId)) {
          this.dirtyInventories.set(characterId, slots);
        }
      }
      throw error;
    } finally {
      const elapsed = performance.now() - start;
      console.log(`${label}: ${elapsed.toFixed(3)}ms`);
      if (elapsed > DB_FLUSH_CRITICAL_THRESHOLD_MS) {
        console.error(
          `[CRITICAL] Database choke - ${label} took ${elapsed.toFixed(2)}ms (>${DB_FLUSH_CRITICAL_THRESHOLD_MS}ms, nearing the 7s flush interval) characters=${characters.size} inventories=${inventories.size}`,
        );
      }
    }
  }
}
