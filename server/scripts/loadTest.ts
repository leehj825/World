import { Client } from '@colyseus/sdk';

const SERVER_HTTP_URL = process.env.LOADTEST_HTTP_URL ?? 'http://localhost:2567';
const SERVER_WS_URL = process.env.LOADTEST_WS_URL ?? 'ws://localhost:2567';

const MOVE_STEP = 4;
const MOVE_INTERVAL_MS = 500;
const SPAWN_STAGGER_MS = 20; // avoid a thundering herd of simultaneous connects
const SUMMARY_INTERVAL_MS = 5000;

const DIRECTIONS = [
  { x: 0, y: -MOVE_STEP }, // W
  { x: -MOVE_STEP, y: 0 }, // A
  { x: 0, y: MOVE_STEP }, // S
  { x: MOVE_STEP, y: 0 }, // D
];

function parseBotCount(): number {
  const arg = process.argv.find((value) => value.startsWith('--bots='));
  const count = arg ? Number(arg.slice('--bots='.length)) : 10;
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`invalid --bots value: ${arg}`);
  }
  return count;
}

async function registerAndLogin(username: string, password: string): Promise<string> {
  const registerResponse = await fetch(`${SERVER_HTTP_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!registerResponse.ok) {
    throw new Error(`register failed (${registerResponse.status}): ${await registerResponse.text()}`);
  }

  const loginResponse = await fetch(`${SERVER_HTTP_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`login failed (${loginResponse.status}): ${await loginResponse.text()}`);
  }

  const { token } = await loginResponse.json();
  return token;
}

interface BotStats {
  connected: boolean;
  movesSent: number;
}

async function spawnBot(index: number, stats: BotStats): Promise<() => Promise<void>> {
  const username = `bot_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`;
  const token = await registerAndLogin(username, 'load-test-password');

  const client = new Client(SERVER_WS_URL);
  const room = await client.joinOrCreate('game_room', { token });
  stats.connected = true;

  room.onError((code, message) => {
    console.error(`[bot ${index}] room error ${code}: ${message ?? ''}`);
  });

  const interval = setInterval(() => {
    const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    room.send('move', direction);
    stats.movesSent++;
  }, MOVE_INTERVAL_MS);

  return async () => {
    clearInterval(interval);
    await room.leave().catch(() => {});
  };
}

async function main() {
  const botCount = parseBotCount();
  console.log(`Spawning ${botCount} bots against ${SERVER_HTTP_URL} (ws: ${SERVER_WS_URL})...`);

  const stats: BotStats[] = Array.from({ length: botCount }, () => ({ connected: false, movesSent: 0 }));
  const cleanups: Array<() => Promise<void>> = [];
  const spawnPromises: Promise<void>[] = [];

  for (let i = 0; i < botCount; i++) {
    spawnPromises.push(
      spawnBot(i, stats[i]!)
        .then((cleanup) => {
          cleanups.push(cleanup);
        })
        .catch((error) => {
          console.error(`[bot ${i}] failed to connect:`, error instanceof Error ? error.message : error);
        }),
    );
    if (i < botCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, SPAWN_STAGGER_MS));
    }
  }

  await Promise.all(spawnPromises);
  const connectedCount = stats.filter((s) => s.connected).length;
  console.log(`${connectedCount}/${botCount} bots connected. Sending 'move' every ${MOVE_INTERVAL_MS}ms each.`);
  console.log('Press Ctrl+C to stop.');

  const summaryInterval = setInterval(() => {
    const nowConnected = stats.filter((s) => s.connected).length;
    const totalMoves = stats.reduce((sum, s) => sum + s.movesSent, 0);
    console.log(`[load-test] connected=${nowConnected}/${botCount} totalMovesSent=${totalMoves}`);
  }, SUMMARY_INTERVAL_MS);
  summaryInterval.unref();

  const shutdown = () => {
    console.log('\nShutting down bots...');
    clearInterval(summaryInterval);
    Promise.all(cleanups.map((cleanup) => cleanup())).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('load test failed to start:', error);
  process.exit(1);
});
