import { MapSchema, Schema, type, view } from '@colyseus/schema';
import { Player } from './Player.js';

export class GameState extends Schema {
  /**
   * @view() gates this entire map behind per-client visibility: an entry is
   * only sent to a client once GameRoom explicitly calls
   * `client.view.add(player)` for it (see GameRoom's AOI/chunk logic).
   */
  @view() @type({ map: Player }) players = new MapSchema<Player>();
}
