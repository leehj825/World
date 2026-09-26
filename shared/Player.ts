import { MapSchema, Schema, type, view } from '@colyseus/schema';
import { InventoryItem } from './InventoryItem.js';

/**
 * Custom @view() tag (must be a power of two) gating `inventory` on top of
 * whatever base visibility a Player entity already has. Being visible in
 * someone's `players` map (per the AOI @view() on GameState.players) is not
 * enough to see this field too — only a view that was explicitly `add()`ed
 * with this exact tag (i.e. the owning client's own view, see GameRoom)
 * gets it. A nearby player's view only ever gets the untagged base fields.
 */
export const INVENTORY_VIEW_TAG = 1;

export class Player extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') hp = 100;
  @type('number') maxHp = 100;

  /** Keyed by slot index (as a string). Only ever visible to the owning client. */
  @view(INVENTORY_VIEW_TAG) @type({ map: InventoryItem }) inventory = new MapSchema<InventoryItem>();
}
