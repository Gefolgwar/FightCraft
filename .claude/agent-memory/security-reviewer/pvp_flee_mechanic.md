---
name: PvP Flee and Battle Mechanics
description: PvP battle logic, including the flee penalty, is fully client-side and can be bypassed.
type: project
---
PvP encounters resolve on the client side in `pvp.js`. A user can manually invoke `updateBattleRequestStatus` to cancel a battle without pressing the "Flee" button, bypassing the 5-minute penalty.
**Why:** The MVP delegates battle state management to the client.
**How to apply:** Ensure future PvP improvements move status transitions (especially flees and cancels) to a secure server-side environment or enforce strict RTDB rules that prevent attackers from canceling their own battles maliciously.