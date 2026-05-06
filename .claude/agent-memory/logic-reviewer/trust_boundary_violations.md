---
name: Critical Trust Boundary Violations
description: Window-exposed functions and overly permissive Firebase rules that enable game exploits
type: project
---

**Window globals enabling exploits** (combat.js:1520-1534, app.js:1233):
- `window.victory()` — instant combat win with full rewards
- `window.addXP(amount)` — arbitrary XP grant
- `window.startCombat(monster)` — combat with fabricated monster data
- `window.gameState` — direct state mutation (exposed via bridge.js)
- `window.triggerSave()` — persist any local changes to Firestore

**Firestore rules gaps** (firestore.rules):
- `castles`: any auth can create/update (should be owner or admin)
- `templates`, `world_chunks`, `world_metadata`, `city_zones`, `world_snapshots`: any auth can create/update (should be admin only)
- `characters` subcollection: no field-level validation on stats (strength, gold, xp can be set to any value)

**RTDB rules gaps** (database.rules.json):
- `battles/$battleId`: `.write: "auth != null"` — anyone can inject PvP results
- `arenas/$arenaId`: `.write: "auth != null"` — anyone can manipulate arenas
- `group_invites`: `.write: "auth != null"` — anyone can forge invitations
- GPS position: no range validation (-90..90, -180..180)

**Why:** Combat and game logic are 100% client-authoritative by architecture. No Cloud Functions exist for server-side validation.
**How to apply:** When reviewing changes to these areas, always check: (1) Is the function on window? (2) Does the Firestore/RTDB rule validate the operation server-side?
