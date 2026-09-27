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

// The load-test script logs its OWN heap usage per wave, which only tells
// us the test harness isn't the bottleneck. The number that actually
// answers "are we hitting V8 memory limits" is this process's — logged on
// the same 15s cadence so the two can be read side by side.
setInterval(() => {
  const { heapUsed } = process.memoryUsage();
  console.log(`[server] heapUsed=${(heapUsed / 1024 / 1024).toFixed(1)}MB`);
}, 15000).unref();
