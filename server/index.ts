import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './GameRoom.js';

const PORT = 2567;

const gameServer = new Server({
  transport: new WebSocketTransport(),
  express: (app) => {
    app.get('/health', (_req, res) => res.send('ok'));
  },
});

gameServer.define('game_room', GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(`GameRoom listening on ws://localhost:${PORT}`);
});
