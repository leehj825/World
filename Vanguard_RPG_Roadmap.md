# Vanguard-RPG: Open-World MMORPG Development Roadmap

## Core Development Philosophy
- **AI as the Dev Team:** Claude Code handles complex architectural scaffolding (netcode, databases) while Jules AI manages asynchronous background tasks (unit testing, CI/CD fixes, linter errors).
- **No Generative AI in Runtime:** The game operates as a pure, deterministic, classic MMORPG.
- **Authoritative Server:** The server completely dictates the game state, validating all client actions to prevent cheating.
- **Decoupled Architecture:** The game client handles 2D/3D rendering, while a separate web framework overlay (React/Vue) manages complex UI elements.

---

## Phase 1: Foundation & Network MVP (Weeks 1-3)
**Goal:** Establish a stable local loopback where a client can connect, move, and have the server broadcast the state.
*   **Action 1: Server Setup:** Prompt Claude to scaffold an authoritative Node.js/Colyseus server.
*   **Action 2: Basic Client Engine:** Set up a lightweight client (e.g., Phaser or Three.js) to capture keyboard inputs and send them to the server.
*   **Action 3: CI/CD Pipeline:** Configure Jules AI via GitHub Actions to automatically run unit tests on every PR Claude generates.

## Phase 2: Persistence & Data Layer (Weeks 4-6)
**Goal:** Ensure player data is securely saved and loaded without blocking the main game loop.
*   **Action 1: Database Schemas:** Have Claude draft PostgreSQL schemas for Player Accounts, Base Stats, and Inventory.
*   **Action 2: Authentication:** Implement secure login/registration endpoints.
*   **Action 3: Async Writes:** Develop the logic to batch-queue player state updates to the database asynchronously to maintain server tick rate.

## Phase 3: World Building & Spatial Systems (Weeks 7-10)
**Goal:** Build the infrastructure to handle an open world without memory bloat or manual asset placement.
*   **Action 1: Spatial Partitioning:** Instruct Claude to implement a spatial grid/chunking system. The server tracks coordinates and only broadcasts updates to clients within nearby chunks.
*   **Action 2: Deterministic Map Generator:** Write a script using a master seed to procedurally generate terrain and spawn zones into static JSON config files (avoiding manual world-building fatigue).
*   **Action 3: Environment Rendering:** Load these JSON files on the client side to render the world chunks as the player explores.

## Phase 4: Core Gameplay & Combat (Weeks 11-14)
**Goal:** Implement the primary gameplay loops with strict server authority.
*   **Action 1: Action Intents:** Code the client to only send "intents" (e.g., "cast fireball at target X").
*   **Action 2: Deterministic Combat:** Have Claude write the server-side combat loop (calculating line of sight, hitboxes, stats, cooldowns).
*   **Action 3: Client Interpolation:** Broadcast the damage and status effects back to the client to trigger animations and visual updates.

## Phase 5: Decoupled UI & Inventory (Weeks 15-18)
**Goal:** Build a robust, responsive user interface outside of the game canvas.
*   **Action 1: React/Vue Overlay:** Scaffold a frontend web framework that sits seamlessly over the game engine canvas.
*   **Action 2: Event Bridge:** Create an event bus so the game engine can send state changes (health drops, item pickups) to update the React components.
*   **Action 3: UI Features:** Use Claude to build out the inventory grid, equipment slots, chat box, and skill trees within the web overlay.

## Phase 6: Polish, Scale, and Testing (Weeks 19-20+)
**Goal:** Stress test the architecture and prepare for alpha launch.
*   **Action 1: Headless Bots:** Assign Jules AI to write headless client scripts that simulate 100+ players connecting and moving simultaneously.
*   **Action 2: Bottleneck Profiling:** Monitor database write locks and CPU tick rates under stress.
*   **Action 3: Delta Compression Refinement:** Optimize the netcode so the server only broadcasts exact state changes rather than full object updates.
