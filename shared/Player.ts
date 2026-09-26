import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
}
