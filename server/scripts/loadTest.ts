// Unlike index.ts, this script doesn't import 'colyseus' (only the client
// SDK), so it doesn't get @colyseus/tools' automatic .env loading side
// effect — load it explicitly so `database`'s prisma client picks up
// DATABASE_URL from server/.env when run via `npm run load-test`.
import 'dotenv/config';
import { Client } from '@colyseus/sdk';
import { prisma } from 'database';
import { MAP_TILES, TILE_SIZE, worldToChunk } from 'shared';

const SERVER_HTTP_URL = process.env.LOADTEST_HTTP_URL ?? 'http://localhost:2567';
const SERVER_WS_URL = process.env.LOADTEST_WS_URL ?? 'ws://localhost:2567';

const MAP_EXTENT_PX = MAP_TILES * TILE_SIZE;
const MOVE_INTERVAL_MS = 500;
const SPAWN_STAGGER_MS = 20; // avoid a thundering herd of simultaneous connects
const SUMMARY_INTERVAL_MS = 5000;

/**
 * A real player is bounded by human key-repeat rate (the client's WASD step
 * is 4px). A load-test bot has no such constraint, and the whole point of
 * this script is to make chunk crossings the norm rather than a rare fluke
 * — so bots move much faster per tick: a minimum 20-tick run already covers
 * 20 * 40 = 800px, a full chunk width, well before the run ends.
 */
const BOT_MOVE_STEP = 40;
const MIN_RUN_TICKS = 20;
const MAX_RUN_TICKS = 30;

const DIRECTIONS = [
  { x: 0, y: -BOT_MOVE_STEP }, // W
  { x: -BOT_MOVE_STEP, y: 0 }, // A
  { x: 0, y: BOT_MOVE_STEP }, // S
  { x: BOT_MOVE_STEP, y: 0 }, // D
];

function pickDirection() {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]!;
}

function pickRunLength(): number {
  return MIN_RUN_TICKS + Math.floor(Math.random() * (MAX_RUN_TICKS - MIN_RUN_TICKS + 1));
}

function parseBotCount(): number {
  const arg = process.argv.find((value) => value.startsWith('--bots='));
  const count = arg ? Number(arg.slice('--bots='.length)) : 10;
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`invalid --bots value: ${arg}`);
  }
  return count;
}

async function register(username: string, password: string): Promise<void> {
  const registerResponse = await fetch(`${SERVER_HTTP_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!registerResponse.ok) {
    throw new Error(`register failed (${registerResponse.status}): ${await registerResponse.text()}`);
  }
}

async function login(username: string, password: string): Promise<string> {
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

/**
 * Scatters this bot's character across the whole map instead of leaving it
 * at the (0, 0) default every fresh registration spawns at. Done as a
 * direct DB update (this script already depends on the `database`
 * workspace) rather than a test-only server intent, so it exercises no
 * server code path that wouldn't also run for a real player — GameRoom's
 * onJoin always spawns from whatever the Character row says.
 */
async function scatterSpawnPosition(username: string): Promise<{ x: number; y: number }> {
  const account = await prisma.account.findUnique({ where: { username } });
  if (!account) throw new Error(`account not found after register: ${username}`);

  const x = Math.random() * MAP_EXTENT_PX;
  const y = Math.random() * MAP_EXTENT_PX;

  await prisma.character.updateMany({ where: { accountId: account.id }, data: { x, y } });
  return { x, y };
}

interface BotStats {
  connected: boolean;
  movesSent: number;
  chunkCrossings: number;
}

async function spawnBot(index: number, stats: BotStats): Promise<() => Promise<void>> {
  const username = `bot_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`;
  const password = 'load-test-password';

  await register(username, password);
  const spawnPosition = await scatterSpawnPosition(username);
  const token = await login(username, password);

  const client = new Client(SERVER_WS_URL);
  const room = await client.joinOrCreate('game_room', { token });
  stats.connected = true;

  room.onError((code, message) => {
    console.error(`[bot ${index}] room error ${code}: ${message ?? ''}`);
  });

  // Tracks this bot's believed position by integrating the same deltas it
  // sends, purely so we can report how often it crosses an AOI chunk
  // boundary — the server's own state is the source of truth for gameplay,
  // this is just load-test telemetry.
  let position = spawnPosition;
  let previousChunk = { chunkX: worldToChunk(position.x), chunkY: worldToChunk(position.y) };
  let direction = pickDirection();
  let ticksRemaining = pickRunLength();

  const interval = setInterval(() => {
    if (ticksRemaining <= 0) {
      direction = pickDirection();
      ticksRemaining = pickRunLength();
    }
    ticksRemaining--;

    room.send('move', direction);
    stats.movesSent++;

    position = { x: position.x + direction.x, y: position.y + direction.y };
    const chunk = { chunkX: worldToChunk(position.x), chunkY: worldToChunk(position.y) };
    if (chunk.chunkX !== previousChunk.chunkX || chunk.chunkY !== previousChunk.chunkY) {
      stats.chunkCrossings++;
      previousChunk = chunk;
    }
  }, MOVE_INTERVAL_MS);

  return async () => {
    clearInterval(interval);
    await room.leave().catch(() => {});
  };
}

async function main() {
  const botCount = parseBotCount();
  console.log(`Spawning ${botCount} bots against ${SERVER_HTTP_URL} (ws: ${SERVER_WS_URL})...`);
  console.log(`Scattered spawn across a ${MAP_EXTENT_PX}x${MAP_EXTENT_PX}px map; directional runs of ${MIN_RUN_TICKS}-${MAX_RUN_TICKS} ticks at ${BOT_MOVE_STEP}px/tick.`);

  const stats: BotStats[] = Array.from({ length: botCount }, () => ({
    connected: false,
    movesSent: 0,
    chunkCrossings: 0,
  }));
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
    const totalCrossings = stats.reduce((sum, s) => sum + s.chunkCrossings, 0);
    console.log(
      `[load-test] connected=${nowConnected}/${botCount} totalMovesSent=${totalMoves} chunkCrossings=${totalCrossings}`,
    );
  }, SUMMARY_INTERVAL_MS);
  summaryInterval.unref();

  const shutdown = () => {
    console.log('\nShutting down bots...');
    clearInterval(summaryInterval);
    Promise.all(cleanups.map((cleanup) => cleanup()))
      .finally(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('load test failed to start:', error);
  process.exit(1);
});
