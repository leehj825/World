import { Schema, type } from '@colyseus/schema';

export class InventoryItem extends Schema {
  @type('string') itemId = '';
  @type('number') quantity = 0;
}
