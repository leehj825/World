import { MapSchema, Schema, type } from '@colyseus/schema';
import { Player } from './Player.js';

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
