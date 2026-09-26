import fs from 'node:fs';
import path from 'node:path';
import { createNoise2D } from 'simplex-noise';
import { CHUNK_TILES, CHUNKS_PER_AXIS, MAP_TILES, TileType } from 'shared';
import type { MapChunk } from 'shared';

const SEED = 1337;

/** Deterministic PRNG (mulberry32) so `createNoise2D` builds the same
 * permutation table on every run given the same SEED. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noise2D = createNoise2D(mulberry32(SEED));

function tileTypeAt(worldX: number, worldY: number): TileType {
  const value = noise2D(worldX / 40, worldY / 40);
  if (value < -0.2) return TileType.Water;
  if (value < 0.3) return TileType.Grass;
  return TileType.Rock;
}

function generateChunk(chunkX: number, chunkY: number): MapChunk {
  const tiles: TileType[][] = [];

  for (let localY = 0; localY < CHUNK_TILES; localY++) {
    const row: TileType[] = [];
    for (let localX = 0; localX < CHUNK_TILES; localX++) {
      const worldX = chunkX * CHUNK_TILES + localX;
      const worldY = chunkY * CHUNK_TILES + localY;
      row.push(tileTypeAt(worldX, worldY));
    }
    tiles.push(row);
  }

  return { chunkX, chunkY, size: CHUNK_TILES, tiles };
}

function main() {
  const outDir = path.join(process.cwd(), 'data', 'map');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let chunkCount = 0;
  for (let chunkY = 0; chunkY < CHUNKS_PER_AXIS; chunkY++) {
    for (let chunkX = 0; chunkX < CHUNKS_PER_AXIS; chunkX++) {
      const chunk = generateChunk(chunkX, chunkY);
      fs.writeFileSync(path.join(outDir, `chunk_${chunkX}_${chunkY}.json`), JSON.stringify(chunk));
      chunkCount++;
    }
  }

  console.log(
    `Generated ${chunkCount} chunks (${MAP_TILES}x${MAP_TILES} tiles, seed=${SEED}) into ${outDir}`,
  );
}

main();
