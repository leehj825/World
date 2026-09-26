import path from 'node:path';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { authRouter } from './auth.js';
import { GameRoom } from './GameRoom.js';

const PORT = 2567;

const gameServer = new Server({
  transport: new WebSocketTransport(),
  express: (app) => {
    app.use(express.json());
    app.get('/health', (_req, res) => res.send('ok'));
    app.use('/auth', authRouter);
    app.use('/data', express.static(path.join(process.cwd(), 'data')));
  },
});

gameServer.define('game_room', GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(`GameRoom listening on ws://localhost:${PORT}`);
});
