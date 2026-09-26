import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import { StateView } from '@colyseus/schema';
import jwt from 'jsonwebtoken';
import { prisma } from 'database';
import { GameState, Player, worldToChunk } from 'shared';
import { StateSyncService } from './StateSyncService.js';

const jwtSecretEnv = process.env.JWT_SECRET;
if (!jwtSecretEnv) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_SECRET: string = jwtSecretEnv;

interface MoveMessage {
  x: number;
  y: number;
}

interface AuthOptions {
  token?: string;
}

interface AuthResult {
  accountId: string;
}

interface ChunkCoords {
  chunkX: number;
  chunkY: number;
}

type GameClient = Client<{ auth: AuthResult }>;

export class GameRoom extends Room<{ state: GameState; client: GameClient }> {
  private readonly stateSync = new StateSyncService();
  private readonly characterIds = new Map<string, string>();
  private readonly playerChunks = new Map<string, ChunkCoords>();

  onCreate() {
    this.setState(new GameState());
    this.stateSync.start();

    this.onMessage<MoveMessage>('move', (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.x += message.x;
      player.y += message.y;

      const characterId = this.characterIds.get(client.sessionId);
      if (characterId) {
        this.stateSync.markDirty(characterId, player.x, player.y);
      }

      this.updateChunkAndVisibility(client, player.x, player.y);
    });
  }

  onAuth(_client: GameClient, options: AuthOptions): AuthResult {
    if (!options.token) {
      throw new Error('missing auth token');
    }

    try {
      const payload = jwt.verify(options.token, JWT_SECRET);
      if (typeof payload === 'string' || typeof payload.accountId !== 'string') {
        throw new Error('malformed auth token');
      }
      return { accountId: payload.accountId };
    } catch {
      throw new Error('invalid auth token');
    }
  }

  async onJoin(client: GameClient) {
    if (!client.auth) {
      throw new Error('missing auth data');
    }

    const character = await prisma.character.findFirst({
      where: { accountId: client.auth.accountId },
    });
    if (!character) {
      throw new Error('no character found for this account');
    }

    this.characterIds.set(client.sessionId, character.id);

    const player = new Player();
    player.x = character.x;
    player.y = character.y;
    this.state.players.set(client.sessionId, player);

    client.view = new StateView();
    client.view.add(player); // always visible to itself, regardless of chunk

    this.updateChunkAndVisibility(client, player.x, player.y);
  }

  async onLeave(client: GameClient) {
    this.state.players.delete(client.sessionId);
    this.playerChunks.delete(client.sessionId);
    client.view?.dispose();

    const characterId = this.characterIds.get(client.sessionId);
    this.characterIds.delete(client.sessionId);

    if (characterId) {
      await this.stateSync.saveNow(characterId);
    }
  }

  onDispose() {
    this.stateSync.stop();
  }

  /**
   * Area-of-interest filtering: a client only ever receives `players` entries
   * that GameRoom explicitly `view.add()`s for it (see the `@view()` tag on
   * GameState.players). Rather than re-evaluating every pair on every tick,
   * we track each connected player's current chunk and only touch visibility
   * for the mover when their chunk actually changes — a cheap integer
   * comparison, no distance math, and O(1) work per already-stationary peer.
   *
   * The chunk-proximity check is symmetric (Chebyshev distance <= 1), so one
   * pass over the other connected clients updates both directions: whether
   * the mover can see each peer, AND whether each peer can see the mover.
   */
  private updateChunkAndVisibility(moverClient: GameClient, x: number, y: number): void {
    const newChunk: ChunkCoords = { chunkX: worldToChunk(x), chunkY: worldToChunk(y) };
    const previousChunk = this.playerChunks.get(moverClient.sessionId);

    if (previousChunk && previousChunk.chunkX === newChunk.chunkX && previousChunk.chunkY === newChunk.chunkY) {
      return;
    }

    this.playerChunks.set(moverClient.sessionId, newChunk);

    const moverPlayer = this.state.players.get(moverClient.sessionId);
    if (!moverPlayer) return;

    for (const otherClient of this.clients) {
      if (otherClient.sessionId === moverClient.sessionId) continue;

      const otherChunk = this.playerChunks.get(otherClient.sessionId);
      const otherPlayer = this.state.players.get(otherClient.sessionId);
      if (!otherChunk || !otherPlayer) continue;

      const inRange =
        Math.abs(newChunk.chunkX - otherChunk.chunkX) <= 1 &&
        Math.abs(newChunk.chunkY - otherChunk.chunkY) <= 1;

      if (inRange) {
        moverClient.view?.add(otherPlayer);
        otherClient.view?.add(moverPlayer);
      } else {
        moverClient.view?.remove(otherPlayer);
        otherClient.view?.remove(moverPlayer);
      }
    }
  }
}
