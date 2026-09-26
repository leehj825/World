import { Client, Room } from 'colyseus';
import { GameState, Player } from 'shared';

interface MoveMessage {
  x: number;
  y: number;
}

export class GameRoom extends Room<{ state: GameState }> {
  onCreate() {
    this.setState(new GameState());

    this.onMessage<MoveMessage>('move', (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.x += message.x;
      player.y += message.y;
    });
  }

  onJoin(client: Client) {
    const player = new Player();
    player.x = 0;
    player.y = 0;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
