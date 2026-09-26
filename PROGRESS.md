# Vanguard-RPG: Progress Log

Tracks what's actually been implemented against `Vanguard_RPG_Roadmap.md`, with
brief notes on any deviation from the original plan and why. Newest entries at
the bottom.

---

## Phase 0: Repo scaffolding cleanup

- Routed `tsc` output to `dist/` for `server` and `shared` instead of
  committing compiled `.js`/`.d.ts` files alongside source.
- Moved `typescript` to `devDependencies`; kept `express`/`colyseus`/
  `uWebSockets.js` as real dependencies for the upcoming server work.
- Stripped default Vite/React boilerplate from `client/` and `ui/`, leaving
  bare entry points (the two are intentionally separate: `client/` is the
  game canvas, `ui/` is a React overlay for later).
- CI (`.github/workflows/ci.yml`) now runs lint + typecheck + build with
  `--if-present` across all workspaces, instead of just a bare build.

## Phase 1: Foundation & Network MVP

- **Action 1 (Server Setup):** `server/GameRoom.ts` — a Colyseus `Room` with
  `onCreate`/`onJoin`/`onLeave` and an authoritative `move` message handler.
  `shared/Player.ts` + `shared/GameState.ts` define the synced schema
  (`@colyseus/schema`).
- **Action 2 (Basic Client Engine):** `client/src/main.ts` connects over
  WebSocket, renders players on a `<canvas>`, and binds WASD to send `move`
  deltas — no client-side prediction, position always comes back from state.
- **Deviation:** the `colyseus` server package here is v0.18, but the classic
  `colyseus.js` client SDK tops out at v0.16 and isn't wire-compatible with
  it. Used `@colyseus/sdk` (v0.18) instead — the client generation that
  actually matches this server/schema version.
- **Action 3 (CI/CD):** GitHub Actions CI added (lint/typecheck/build gate);
  no Jules AI integration in this environment, so that half of Action 3 is
  out of scope here.

## Phase 2: Persistence & Data Layer

- **Action 1 (Database Schemas):** new `database` workspace. `Account`
  (id, username, passwordHash, createdAt) and `Character`
  (id, accountId, name, x, y) via Prisma.
  - **Deviation:** Prisma's newest generator (`prisma-client`, v7/v8) emits
    raw `.ts` files with `.ts`-extension imports that don't survive our
    `nodenext` `tsc` build or a plain `node dist/index.js` in prod. Pinned
    `prisma`/`@prisma/client` to `6.19.3` with the classic `prisma-client-js`
    generator, which compiles to plain JS importable via `@prisma/client`
    everywhere — no extra tooling needed.
- **Action 2 (Authentication):** `server/auth.ts` — `POST /auth/register`
  (bcrypt hash, creates Account + default Character) and `POST /auth/login`
  (verifies password, returns a JWT with `accountId`). `GameRoom.onAuth`
  verifies that JWT from `options.token` before a client can join; `onJoin`
  spawns the player at their saved `(x, y)` instead of `(0, 0)`.
- **Action 3 (Async Writes):** `server/StateSyncService.ts` — an in-memory
  "dirty" map flushed to Postgres every 7s via one `$transaction`, so `move`
  messages never touch the DB directly. `onLeave` forces an immediate
  single-character save so a disconnect right before a flush doesn't lose
  the final position. All writes (periodic batches and one-off disconnect
  saves) run through a single FIFO queue so a stale batch can never clobber
  a fresher save, or vice versa.

## Phase 3: World Building & Spatial Systems

- **Action 2 (Deterministic Map Generator):** `server/scripts/generateMap.ts`
  — simplex-noise terrain seeded with a fixed mulberry32 PRNG, writing one
  JSON file per 25x25 chunk to `server/data/map/` (500x500 tile map, 400
  chunks). Fully deterministic — re-running produces byte-identical output.
- **Action 3 (Environment Rendering):** client `ChunkManager` fetches the
  3x3 chunk neighborhood around the local player over plain HTTP
  (`express.static` serving `/data`), evicts chunks that fall out of range,
  and renders tiles under the player squares from a camera centered on the
  local player.
- **Action 1 (Spatial Partitioning / AOI):** `GameState.players` is
  filtered so a client only receives players in its own chunk or the 8
  adjacent ones.
  - **Deviation:** the installed `@colyseus/schema` version doesn't have the
    classic `@filter((client, value) => boolean)` decorator — it was
    replaced by an explicit `StateView` system. Implemented AOI on that:
    `@view()` gates the `players` map, each client gets its own `StateView`,
    and `GameRoom` tracks each player's chunk (recomputed only when it
    actually changes) to add/remove players from each other's views based
    on chunk proximity.

## Phase 4: Core Gameplay & Combat

- **Action 1 (Action Intents):** `shared/messages.ts` — `AttackMessage`
  (`{ targetId }`) is the only thing the client sends; no damage numbers or
  outcomes originate client-side.
- **Action 2 (Deterministic Combat):** `GameRoom`'s `attack` handler
  validates the target exists, isn't the attacker, and is within 48px
  (Euclidean) before applying damage. Damage always comes from the
  attacker's own server-tracked `attackPower` (kept private per session,
  deliberately *not* part of the replicated `Player` schema so a client
  can't spoof its own damage output). A kill resets `hp` to `maxHp` and
  teleports to `(0, 0)`. `hp`/`maxHp` were added to `Character` (Prisma) and
  `Player` (synced schema); `attackPower` only to `Character`.
- **Action 3 (Client Interpolation):** `combat_event` is broadcast
  room-wide (per the roadmap note that per-client AOI-scoped broadcasting
  is a later optimization) and drives a 150ms red flash plus a floating
  "-N" damage number on the client. The render loop was switched from
  state-patch-driven to `requestAnimationFrame`-driven so these animations
  stay smooth independent of Colyseus's patch rate.
- Every hp/position mutation (movement and combat alike) flows through the
  same `StateSyncService.markDirty()` path from Phase 2, so combat damage
  rides the existing write-behind queue.

## Phase 5: Decoupled UI & Inventory (chat, event bridge)

- **Action 1 (Event Bridge):** `client/src/EventBus.ts` — a zero-dependency
  pub/sub over native `window` `CustomEvent`s
  (`emitGameStateChange`/`onGameStateChange`, `emitIntent`/`onIntent`,
  `emitChatMessage`/`onChatMessage`). Neither side imports the other
  directly; this module is the only shared surface. `client/src/main.ts`
  no longer mounts anything itself — it now exports `initGame(canvas,
  token)`, which takes an externally-owned canvas and resizes to fill it.
  `client/package.json` points `main`/`types` straight at `src/index.ts`
  (no build step; Vite transforms the raw `.ts` on import like any other
  source file).
- **Action 2 (React Integration):** `ui` now depends on `client`.
  `App.tsx` holds a `useRef<HTMLCanvasElement>`, calls `initGame` in a
  `useEffect` once a JWT is available, and wraps overlay panels in a
  `pointer-events: none` container so clicks fall through to the canvas
  everywhere except an actual panel (which opts back in with
  `pointer-events: auto`) — this matters because Phase 4's
  click-to-attack still needs to reach the canvas through the UI layer.
  `LoginForm.tsx` is the HTML login form migrated into a real React
  component managing its own state, calling `initGame`'s token callback
  on success.
  - **Deviation:** `ui/vite.config.ts` needed `optimizeDeps.include:
    ['shared', 'client']` — the same fix from Phase 3's `client/vite.config.ts`,
    needed again here because `shared`'s compiled CommonJS is now reached
    transitively through `client` too, and Vite would otherwise serve it
    as unconverted ESM via `/@fs`.
- **Action 3 (Global Chat):** `shared/messages.ts` gained `ChatInput`
  (`{ text }`, client → server) and `ChatMessage` (`{ sender, text }`,
  server → clients) — the client never sends a sender name; `GameRoom`
  resolves it from the authenticated character, the same trust boundary
  established for `attackPower` in Phase 4. `GameRoom`'s new
  `chat_message` handler trims/caps the text and broadcasts room-wide.
  `ChatBox.tsx` sends via `emitIntent({ type: 'chat', text })` and renders
  incoming messages via `onChatMessage`.
- Added `HudBar.tsx` (a live HP readout via `onGameStateChange`) — not
  asked for explicitly, but added so that helper is actually exercised by
  something instead of shipping as a dead/never-called export.

## Phase 5 continued: Inventory & private state

- **Database:** `InventoryItem` model (`characterId`, `itemId`,
  `slotIndex`, `quantity`; unique on `characterId`+`slotIndex`).
  `auth.ts` grants 5 `health_potion`s in slot 0 on registration, nested
  three levels deep in one Prisma create (`Account` → `Character` →
  `InventoryItem`).
- **Private state:** `shared/Player.ts` gained `inventory` (a
  `MapSchema<InventoryItem>` keyed by slot index) decorated
  `@view(INVENTORY_VIEW_TAG)` — a *custom* tag, not the bare `@view()`
  already used for `GameState.players`. This is the actual privacy
  mechanism: being visible in someone's `players` map (base AOI
  visibility) does **not** imply visibility of every field on that
  entity — a field behind a custom tag is only visible to a view that
  was explicitly granted that exact tag. `GameRoom` grants it only to a
  client's own player (`client.view.add(player, INVENTORY_VIEW_TAG)` at
  `onJoin`); the AOI loop that adds nearby players to each other's views
  never passes this tag, so a nearby player's inventory is structurally
  absent from your view — not hidden client-side, never encoded to your
  client at all. Verified directly: session A's view of session B has
  `x`/`y`/`hp` populated but `inventory` is `undefined`, while A's own
  inventory is fully populated.
- **Server logic:** `GameRoom`'s `move_item` handler validates slot range
  and that the source slot actually holds an item — the client's two
  slot numbers are the only untrusted input — then swaps the two
  `MapSchema` entries authoritatively.
- **Persistence:** `StateSyncService` gained a second dirty-tracking path
  for inventories, sharing the same FIFO `writeQueue` as position/hp so a
  flush and a disconnect-save can never land out of order for the same
  character. Inventory is one-row-per-item rather than one-row-per-character,
  so a "move" can't be expressed as a single `UPDATE` the way x/y/hp can;
  persist instead replaces a dirty character's whole slot set
  (`deleteMany` + `createMany`) from the in-memory snapshot taken at
  `markInventoryDirty()` time.
- **React UI:** `EventBus` gained `emitInventoryChange`/`onInventoryChange`
  and a `move_item` intent variant. `InventoryGrid.tsx` is a 4x5 grid
  toggled by an on-screen button or the "I" key, with click-to-select
  then click-to-swap driving `emitIntent({ type: 'move_item', ... })`.

---

## Verification approach

Every phase above was checked against a real, running stack before being
called done — not just typechecked:
- A local Postgres 16 instance for migrations and persistence checks.
- The actual compiled server (`node dist/index.js`) and Vite dev client.
- A throwaway `@colyseus/sdk` script to script multi-client scenarios
  (join, move, attack, disconnect) and assert on the resulting state and
  DB rows.
- Headless-browser (Playwright) runs driving the real login form, canvas,
  and mouse/keyboard input, with pixel-level and screenshot checks for
  terrain colors, health bars, hit flashes, floating damage numbers, the
  React HUD/chat DOM, and cross-session chat delivery.

## Not yet started

- Phase 5 remainder: equipment slots, skill trees (event bridge, chat, and
  inventory grid are done).
- Phase 6: Polish, Scale, and Testing (no headless load-testing bots or
  delta-compression tuning yet).
