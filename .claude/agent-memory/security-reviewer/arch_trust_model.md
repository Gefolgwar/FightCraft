---
name: Architecture Trust Model
description: FightCraft is currently a fully client-authoritative MVP. Client controls all stats.
type: project
---
FightCraft operates as a fully client-authoritative application. The client uses IndexedDB for caching and pushes state directly to Firestore and RTDB. 
**Why:** The project has no server-side logic (Cloud Functions) and relies entirely on Firebase Security Rules, which currently lack schema validation.
**How to apply:** Whenever reviewing features involving XP, Gold, PvP, or Progression, flag client-side state manipulation and recommend either Cloud Functions or strict Firebase rule validation. Do not trust client-side deductions (e.g., `gameState.player.gold -= 1000`).