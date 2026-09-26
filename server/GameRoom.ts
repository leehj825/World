import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import jwt from 'jsonwebtoken';
import { prisma } from 'database';
import { GameState, Player } from 'shared';
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

type GameClient = Client<{ auth: AuthResult }>;

export class GameRoom extends Room<{ state: GameState; client: GameClient }> {
  private readonly stateSync = new StateSyncService();
  private readonly characterIds = new Map<string, string>();

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
  }

  async onLeave(client: GameClient) {
    this.state.players.delete(client.sessionId);

    const characterId = this.characterIds.get(client.sessionId);
    this.characterIds.delete(client.sessionId);

    if (characterId) {
      await this.stateSync.saveNow(characterId);
    }
  }

  onDispose() {
    this.stateSync.stop();
  }
}
