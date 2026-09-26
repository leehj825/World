export const TILE_SIZE = 32;
export const CHUNK_TILES = 25;
export const MAP_TILES = 500;
export const CHUNKS_PER_AXIS = MAP_TILES / CHUNK_TILES;
export const CHUNK_SIZE_PX = CHUNK_TILES * TILE_SIZE;

export enum TileType {
  Water = 0,
  Grass = 1,
  Rock = 2,
}

export interface MapChunk {
  chunkX: number;
  chunkY: number;
  size: number;
  tiles: TileType[][];
}

/** Converts a world-space coordinate (in the same units as Player.x/y) to a chunk index. */
export function worldToChunk(coordinate: number): number {
  return Math.floor(coordinate / CHUNK_SIZE_PX);
}

export function chunkFileName(chunkX: number, chunkY: number): string {
  return `chunk_${chunkX}_${chunkY}.json`;
}

export function isValidChunk(chunkX: number, chunkY: number): boolean {
  return chunkX >= 0 && chunkX < CHUNKS_PER_AXIS && chunkY >= 0 && chunkY < CHUNKS_PER_AXIS;
}
