import { prisma } from 'database';

interface PendingPosition {
  x: number;
  y: number;
}

/**
 * Write-behind cache for Character positions. `move` messages only ever
 * touch the in-memory `dirty` map (synchronous, cheap); the actual Postgres
 * write happens on a timer so the game loop is never blocked on I/O.
 *
 * Concurrency: every DB write — periodic batch flushes and the one-off
 * `saveNow()` used on disconnect — runs through a single FIFO `writeQueue`
 * promise chain. Deciding *what* to write (snapshotting/clearing `dirty`)
 * always happens synchronously before a job is enqueued, so there's no
 * window where two writes could be built from inconsistent data, and
 * because the queue is strictly FIFO, a write can never be applied out of
 * the order it was enqueued in — a stale flush can't clobber a fresher
 * disconnect-save, or vice versa. See `saveNow()` for the exact interleaving
 * with a concurrent flush.
 */
export class StateSyncService {
  private dirty = new Map<string, PendingPosition>();
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

  /** Called from the `move` handler. Cheap, synchronous, never touches the DB. */
  markDirty(characterId: string, x: number, y: number): void {
    this.dirty.set(characterId, { x, y });
  }

  /**
   * Snapshot everything currently dirty and hand it to the write queue.
   * The snapshot+clear is synchronous, so any `markDirty` calls that happen
   * while the batch is in flight land in a fresh map rather than being lost
   * or racing the write.
   */
  flush(): Promise<void> {
    if (this.dirty.size === 0) return this.writeQueue;

    const snapshot = this.dirty;
    this.dirty = new Map();

    return this.enqueue(snapshot);
  }

  /**
   * Force an immediate save of one character — used on disconnect so the
   * final position isn't lost if it lands between periodic flushes.
   *
   * If a periodic flush already snapshotted this character (took it out of
   * `dirty`) but hasn't finished writing yet, `dirty.get()` here returns
   * nothing: there's nothing fresher to save, and awaiting `writeQueue`
   * ensures we still don't return until that in-flight write (which already
   * has this character's latest position) has landed.
   */
  saveNow(characterId: string): Promise<void> {
    const pending = this.dirty.get(characterId);
    if (!pending) return this.writeQueue;

    this.dirty.delete(characterId);
    return this.enqueue(new Map([[characterId, pending]]));
  }

  private enqueue(entries: Map<string, PendingPosition>): Promise<void> {
    this.writeQueue = this.writeQueue.then(
      () => this.persist(entries),
      () => this.persist(entries), // keep the queue alive even if a prior job rejected
    );
    return this.writeQueue;
  }

  private async persist(entries: Map<string, PendingPosition>): Promise<void> {
    if (entries.size === 0) return;

    try {
      await prisma.$transaction(
        Array.from(entries, ([characterId, { x, y }]) =>
          prisma.character.update({ where: { id: characterId }, data: { x, y } }),
        ),
      );
    } catch (error) {
      // Put failed writes back so the next flush retries them, but never
      // clobber a value that changed again in the meantime.
      for (const [characterId, position] of entries) {
        if (!this.dirty.has(characterId)) {
          this.dirty.set(characterId, position);
        }
      }
      throw error;
    }
  }
}
