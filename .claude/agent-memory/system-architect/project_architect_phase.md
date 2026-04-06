---
name: project_architect_phase
description: Initiated ARCHITECT_PHASE to modernize FightCraft from vanilla JS to Vite/TypeScript
type: project
---

The project is currently entering the ARCHITECT_PHASE to address structural, scalability, and modularity issues in the FightCraft HTML5/JS/Firebase RPG.

**Why:** The current architecture relies on plain JS modules, inline `onclick` handlers, a global `bridge.js` registry, and a mutable `gameState.js` singleton. This makes the game fragile, hard to scale, and prone to memory leaks and typing errors (especially with BigInt XP).
**How to apply:** All future architectural suggestions and implementation steps should focus on migrating to a Vite bundler, decoupling the UI via an event-driven or component-based model (removing `window` global reliance), introducing TypeScript for safety, and moving authoritative game logic (like combat math) to Firebase Cloud Functions.