# CLAUDE.md - Project Vanguard MMO Architecture & Constraints

## Core Principles
*   **Authoritative Server:** The server dictates ALL game state. The client is a dumb terminal that interpolates visual state and sends inputs.
*   **Never Trust the Client:** Validate all movement, combat, and inventory actions on the server.
*   **Agent Task Division:** Claude Code handles complex, multi-file architectural features (combat loops, spatial partitioning, network serialization). Jules AI handles isolated background tasks (unit tests, CI/CD fixes) via GitHub issues.

## Build & Run Commands
*   Start authoritative server: `npm run server:dev`
*   Start client environment: `npm run client:dev`
*   Run test suite: `npm test`
*   Apply database migrations: `npm run db:migrate`

## Project Structure
*   `/server`: Node.js/Colyseus backend, authoritative state, anti-cheat validation.
*   `/client`: Frontend engine, input sampling, visual interpolation.
*   `/shared`: TypeScript interfaces, network message schemas, and shared constants.
*   `/database`: PostgreSQL schemas and ORM models.

## Coding Style & Architecture
*   **Typing:** Use strict TypeScript (`"strict": true`). No `any` types permitted.
*   **State Sync:** Use delta compression. Only broadcast properties that have changed since the last server tick.
*   **Spatial Partitioning:** All entities must be assigned to a grid cell. The server must only broadcast state updates to clients within the same or adjacent cells.
*   **Database Persistence:** Never block the main game loop with database queries. Queue all inventory and player state writes to PostgreSQL and process them asynchronously in batches.
*   **Combat Logic:** All hit registration and damage calculations occur on the server. Clients predict visual hits but instantly roll back if the server rejects the action.

## Jules AI Handoff Protocol
*   If you (Claude) identify missing unit tests, linter errors, or isolated visual bugs during a major feature build, DO NOT fix them yourself.
*   Instead, document the issue and instruct the user to open a GitHub Issue with the label `jules-task`.
*   Preserve your context window for high-level architectural logic.
