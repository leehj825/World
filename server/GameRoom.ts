import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import jwt from 'jsonwebtoken';
import { prisma } from 'database';
import { GameState, Player } from 'shared';

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
  onCreate() {
    this.setState(new GameState());

    this.onMessage<MoveMessage>('move', (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.x += message.x;
      player.y += message.y;
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

    const player = new Player();
    player.x = character?.x ?? 0;
    player.y = character?.y ?? 0;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: GameClient) {
    this.state.players.delete(client.sessionId);
  }
}
