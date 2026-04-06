---
name: Project Performance State
description: Current known performance hotspots, database read patterns, and memory issues
type: project
---

The project uses Firebase (Firestore + RTDB) and IndexedDB (via SyncEngine) with the following performance characteristics:

1. **RTDB Real-time Sync Overhead:** `live_players` listener uses `onValue()` on the global node, causing exponential O(N^2) data transfer as player count grows. Should use `onChildChanged/Added` or shard by geographic region.
2. **Redundant Firestore Reads:** The `world_metadata/current_state` document is repeatedly fetched by concurrent initialization scripts (`syncWorld`, `syncCityZones`, `syncTemplates`).
3. **Redundant Game Loops:** Multiple `setInterval` calls in `app.js` can accidentally duplicate execution of hot path functions like `updateRegeneration()` and DOM updates.
4. **Spatial Query Memory:** IndexedDB `getAllFromIndexedDB()` is used to load all spawned objects into memory before filtering by distance using Turf.js.

**Why:** Minimizing Firestore reads directly lowers cost. Reducing JS allocations in loops and RTDB bandwidth improves battery life and frame rates on mobile (Capacitor).
**How to apply:** When creating or modifying data fetching, pass cached metadata down rather than re-requesting. Avoid `getAll()` from IDB. Use targeted RTDB events. Ensure single sources of truth for game loop intervals.