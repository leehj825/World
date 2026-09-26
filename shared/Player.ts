import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') hp = 100;
  @type('number') maxHp = 100;
}
