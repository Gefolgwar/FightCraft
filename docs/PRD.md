# FightCraft - Product Requirements Document

**Version:** 1.1
**Date:** 2026-04-19
**Status:** Living Document
**Live URL:** https://fight-craft-3c3f0.web.app

---

## Problem Statement

Mobile gamers want a real-world exploration RPG that blends physical movement with competitive combat. Existing geolocation games either lack real-time PvP or rely on simplistic tap mechanics. Players want depth: character builds, equipment strategy, zone-based tactical combat, territory control, and the ability to team up with nearby friends to fight together -- all tied to their actual physical location. No game on the market combines real-time multiplayer PvP, group combat, territory capture, and full RPG progression in a geolocation context with a lightweight, bundler-free web stack that works on both browsers and Android.

---

## Solution

FightCraft is a geolocation RPG delivered as an HTML5 web app (wrapped via Capacitor for Android) that uses the player's real GPS coordinates to place them on a Leaflet map populated with monsters, shops, castles, and other players. Players engage in zone-based tactical combat (head/body/belt/legs), progress through an attribute-driven RPG system, equip loot, form groups for cooperative fights, challenge other players to real-time PvP via Firebase Realtime Database, and capture territorial citadels for passive income. The entire backend runs on Firebase (Auth + Firestore + RTDB + Storage + Hosting), and a SyncEngine with IndexedDB caching reduces Firestore reads by ~99.6%.

---

## User Stories

### Authentication & Character Management

1. As a new player, I want to sign up via Firebase Auth, so that my progress is saved across devices.
2. As a returning player, I want my last-played character to auto-load from localStorage, so that I skip the selection screen.
3. As a player, I want to create multiple characters under one account, so that I can try different builds.
4. As a player, I want to select a character avatar from a set of emoji icons, so that I have visual identity.
5. As a player, I want to delete a character, so that I can free up slots for new builds.
6. As a player, I want to switch characters mid-session, so that I can play a different build without re-logging.
7. As a player, I want to log out, so that I can secure my account on shared devices.

### Map & Geolocation

8. As a player, I want to see my real-time position on a Leaflet map, so that I can navigate the game world.
9. As a player, I want a fog of war overlay that clears as I explore, so that discovery feels rewarding.
10. As a player, I want to see other online players on the map as markers, so that I know who is nearby.
11. As a player, I want a "center on me" button, so that I can quickly find myself after panning.
12. As a player, I want to see district boundaries on the map, so that I understand territorial divisions.
13. As a player, I want to toggle district visibility on/off, so that I can reduce visual clutter.
14. As a player, I want to see a district HUD showing the current district name, its king, and tax rate, so that I have territorial awareness.
15. As a player, I want the map to fall back to Berlin coordinates (52.484512, 13.449876) when GPS is unavailable, so that the game remains playable for testing.
16. As a player, I want my last known GPS position to be restored on reconnect, so that I don't teleport to Berlin after a brief disconnection.

### Character Progression & Stats

17. As a player, I want 6 base attributes (Strength, Agility, Intuition, Vitality, Intellect, Wisdom), so that I can customize my build.
18. As a player, I want to earn 5 stat points per level-up, so that I can allocate them to my preferred attributes.
19. As a player, I want derived stats (Health, Damage, Crit, Hit Chance, Dodge, Regen, Vision Radius) calculated from attributes + equipment, so that build choices have tangible effects.
20. As a player, I want XP tracked as BigInt for future-proof large numbers, so that high-level progression doesn't break.
21. As a player, I want a quadratic XP curve (500 * level^2), so that leveling slows meaningfully at higher levels.
22. As a player, I want full HP restoration on level-up, so that leveling feels rewarding.
23. As a player, I want HP regeneration out of combat (based on Vitality + Intellect), so that I recover between fights.
24. As a player, I want a 5-second regen cooldown after taking damage, so that regen doesn't trivialize combat.
25. As a player, I want an interaction/vision radius (25m + Wisdom * 2m), so that stat investment affects gameplay reach.

### Equipment & Inventory

26. As a player, I want 7 equipment slots (helmet, armor, shield, sword, boots, gloves, belt), so that I can gear up fully.
27. As a player, I want equipment to provide attribute bonuses and defense, so that loot progression matters.
28. As a player, I want items with rarity tiers (Common, Uncommon, Rare, Epic), so that loot drops feel exciting.
29. As a player, I want items with stat requirements (e.g., Strength 15 for Plate Armor), so that build choices gate equipment access.
30. As a player, I want a grid-based inventory with category filters (All, Weapons, Armor, Resources), so that I can manage loot efficiently.
31. As a player, I want an item detail modal showing stats, requirements, description, and actions (Equip/Use/Drop), so that I can make informed decisions.
32. As a player, I want consumable items like Health Potions (30% HP) and Greater Health Potions (70% HP), so that I can heal strategically.
33. As a player, I want to see my equipped items on the character panel alongside derived stats, so that I have a full build overview.

### PvE Combat

34. As a player, I want to encounter monsters on the map that I can tap to initiate combat, so that exploration leads to fights.
35. As a player, I want a pre-combat dialog showing monster stats (name, level, class, damage, HP), so that I can assess the threat before engaging.
36. As a player, I want a zone-based attack system (Head, Body, Belt, Legs), so that combat has tactical depth.
37. As a player, I want a zone-based defense system (Head+Body, Body+Belt, Belt+Legs, Head+Legs), so that I must predict enemy attacks.
38. As a player, I want combat to resolve each round based on attack zone vs. defense zone matchups, hit chance, crit chance, and dodge, so that outcomes feel fair and skill-based.
39. As a player, I want combat to automatically generate a 50m radius "Arena" on the map centered on the initiating player; leaving this boundary causes an auto-defeat.
40. As a player, I want monster affixes (Stone Skin, Extra Strong, Teleport, Cursed, Mana Burn), so that enemies have variety.
41. As a player, I want monster classes (Normal, Champion, Unique, Super Unique), so that difficulty is clearly communicated.
42. As a player, I want XP and gold rewards on victory, so that combat is the primary progression driver.
43. As a player, I want item drops on victory, so that combat feeds the loot loop.
44. As a player, I want a victory screen showing XP gained, gold earned, and items dropped, so that reward feedback is clear.
45. As a player, I want a defeat screen with a "Revive" button, so that death has consequences but isn't permanent.
46. As a player, I want a flee option that costs -30% Gold, -5% XP, a random item, and puts the monster on 1-hour cooldown, so that fleeing is a real tradeoff.
47. As a player, I want monster cooldowns after being defeated, so that I can't farm the same monster endlessly.
48. As a player, I want combat equipment displayed on both player and enemy cards during combat, so that I can visually compare loadouts.

### PvP Combat

49. As a player, I want to challenge another online player to a PvP fight via their map marker or the online players list, so that PvP is accessible.
50. As a player, I want PvP battle requests synced in real-time via Firebase RTDB, so that challenges are instant.
51. As a player, I want to accept or decline incoming PvP requests, so that I'm not forced into fights.
52. As a player, I want real-time PvP combat using the same zone-based system as PvE, so that skills transfer between modes.
53. As a player, I want PvP draws when both players reach 0 HP simultaneously, so that ties are handled fairly.
54. As a player, I want HP restored to 30% after a draw, so that I can continue playing.
55. As a player, I want a 5-minute cooldown/penalty incurred for fleeing a PvP combat.
56. As a player, I want PvP win/loss/draw stats tracked on my profile, so that I can measure my performance.
57. As a player, I want leaderboards categorized by type (street for most wins, couch for most losses, and level-based). 2v2, 3v3, and FFA are planned future modes.
58. As a player, I want PvP combat to auto-reconnect if I refresh mid-fight (via localStorage battleId + RTDB status), so that disconnects don't auto-lose.
59. As a player, I want PvP combat arenas (50m boundaries) enforced so players cannot physically run away without triggering an auto-defeat.

### Group System

60. As a player, I want to create a group and invite nearby players, so that I can team up for fights.
61. As a player, I want to receive group invitations as in-game notifications, so that I can join friends.
62. As a player, I want to accept or decline group invites, so that grouping is consensual.
63. As a player, I want a Group HUD showing my group members and their status, so that I know who's with me.
64. As a player, I want group combat where my team fights a monster or another group in a unified Team A vs Team B structure synced via RTDB.
65. As a player, I want proximity checks ensuring that *all* group members are within interaction radius (default 50m) of the target to initiate a fight.
66. As a player, I want visual team colors (e.g., `#22c55e`) assigned to groups so I can easily identify group members on the UI and Map.
67. As a player, I want to leave or disband a group at any time, so that I maintain social autonomy.
68. As a player, I want group state synced in real-time via RTDB, so that all members see consistent group status.

### Kingdom & Territory

69. As a player, I want city districts with named boundaries, so that the world has geographic structure.
70. As a player, I want a citadel in each district that I can visit when within 50m, so that territorial control has a physical anchor.
71. As a player, I want to capture an unowned citadel to become King of the district, so that territorial expansion is possible.
72. As a player, I want to challenge the current King of a citadel, so that control is contested.
73. As a king, I want passive gold income from my controlled district (hourly), so that territory ownership is rewarding.
74. As a king, I want an income tracker HUD showing gold amount and progress bar, so that I know when income arrives.
75. As a king, I want a safe storage system at my citadel to protect gold and items from PvP losses, so that I have strategic resource management.

### World Sync & Spawning

76. As a player, I want monsters, shops, and castles spawned from Firestore and synced per-city, so that the world is persistent and shared.
77. As a player, I want the world to re-sync when I move to a different city zone, so that content is location-relevant.
78. As a player, I want shops where I can buy and sell items, so that gold has economic utility.
79. As a player, I want monsters spawned on a grid (500m spacing) around city anchors, so that distribution is predictable.
80. As an admin, I want Firestore templates for monsters, shops, and castles, so that world content is data-driven.
81. As an admin, I want admin pages (Monsters, Shops, Castles, Leveling Table) to manage world generation, so that content can be tuned without code changes.

### Quests

82. As a player, I want progress-tracking quests (First Steps: kill 5 monsters, Collector: collect 10 items, Boss Slayer: kill 3 Uniques, Traveler: walk 1000m), so that I have short-term goals.
83. As a player, I want quest rewards (XP, gold, specific items), so that completing quests is meaningful.
84. As a player, I want a Quests panel showing progress bars and reward previews, so that I can track multiple objectives.

### Online Players & Social

85. As a player, I want an online players panel showing who is nearby with their level and status, so that I have social awareness.
86. As a player, I want an online player count badge, so that I know how populated my area is.
87. As a player, I want to interact with online players (challenge to PvP, invite to group) from the online panel, so that social actions are convenient.

### Settings & UI

88. As a player, I want toggles for Sound, Notifications, Fog of War, and Vibration, so that I can customize my experience.
89. As a player, I want a loading screen with progress bar during initialization, so that I know the game is starting.
90. As a player, I want a bottom navigation bar (Hero, Inventory, Center, Quests, Stats, Menu), so that core screens are always accessible.
91. As a player, I want an event log showing recent game events, so that I can review what happened.
92. As a player, I want notification toasts for important events (level-up, combat results, invites), so that I don't miss key moments.
93. As a player, I want a reset progress option with confirmation dialog, so that I can start fresh if desired.

### Admin & Debug

94. As an admin, I want a debug mode with joystick movement, speed controls, and teleportation, so that I can test without physically moving.
95. As an admin, I want buttons to spawn test monsters, give test items/XP/gold, and full heal, so that I can test combat quickly.
96. As an admin, I want a system console mirroring browser console output, so that I can debug on mobile.
97. As an admin, I want debug mode restricted to admin/moderator accounts, so that regular players can't cheat.
98. As an admin, I want Firebase usage monitoring (reads/writes/deletes/RTDB operations), so that I can track billing.

### Performance & Optimization

99. As a player, I want a SyncEngine that caches Firestore data in IndexedDB, so that app startup is fast and Firestore reads are minimized. The SyncEngine prioritizes downloading pre-generated JSON bundles from Firebase Storage before falling back to Firestore queries.
100. As a player, I want debounced saves (5s after last change) instead of periodic saves, so that Firestore writes are efficient.
101. As a player, I want position updates sent via RTDB (not Firestore), so that real-time position sync is cheap.
102. As a player, I want player presence auto-cleanup via RTDB onDisconnect, so that offline players are removed from the map.

### Mobile (Android)

103. As a player, I want the game to work as an Android app via Capacitor, so that I get native GPS access and app-store distribution.
104. As a player, I want the mobile viewport locked (no user scaling), so that the UI doesn't break on pinch gestures.

---

## Implementation Decisions

### Architecture

- **No bundler** -- JS files are served directly as ES6 modules via Firebase Hosting. This keeps the build process trivial (just deploy) at the cost of many HTTP requests and inability to tree-shake CDN dependencies.
- **Three Firebase services** with distinct roles: Firestore for persistent state, RTDB for real-time ephemeral state (positions, battles, groups), Storage for static bundles. Firebase security rules (`firestore.rules`, `database.rules.json`, `storage.rules`) are located in a dedicated `/firebase/` folder.
- **Modular frontend** organized into 8 domain folders (`core/`, `auth-ui/`, `firebase/`, `gameplay/`, `map/`, `maintenance/`, `css/`, `assets/`) after a recent refactor from a flat `www/js/` structure.
- **Module Loading:** `www/core/index.html` is the true entry point, loading external libraries. The core scripts are `www/auth-ui/ui-loader.js`, `www/core/app.js`, and `www/core/bridge.js`.
- **Window globals via bridge.js** -- inline `onclick` handlers in HTML require functions on `window`. This pattern is intentional to avoid a build step but creates tight coupling.

### Key Modules

| Module | Responsibility | Testability |
|--------|---------------|-------------|
| **Game State** (`core/gameState.js`) | In-memory state singleton, stat recalculation, equipment/inventory mutations | High -- pure functions, no DOM dependencies |
| **Combat Engine** (`gameplay/combat.js`) | PvE + PvP + Group combat logic, zone-based damage resolution, flee penalties | Medium -- combat math is testable but UI is tightly coupled |
| **Battle Logic** (`gameplay/battle-logic.js`) | Extracted combat math (damage calc, hit/dodge/crit rolls) | High -- pure computation |
| **Firebase Service** (`firebase/firebase-service.js`) | All Firebase CRUD, auth, RTDB subscriptions, admin checks | Low -- heavily side-effectful, requires Firebase mocks |
| **Map** (`map/map.js`) | Leaflet map init, markers, player/monster rendering, arenas | Low -- DOM + Leaflet dependency |
| **Data** (`gameplay/data.js`) | Static item/monster databases, city anchors, grid settings | High -- pure data export |
| **Sync Engine** (`gameplay/sync-engine.js`) | IndexedDB caching layer for Firestore optimization | Medium -- depends on IndexedDB API |
| **Districts** (`map/districts.js`) | Overpass API integration for geographic districts, point-in-polygon | Medium -- geometry is testable |
| **Groups** (`gameplay/groups.js`) | RTDB-synced group CRUD, invite flow | Low -- RTDB-dependent |
| **PvP** (`gameplay/pvp.js`) | Leaderboards, battle requests, PvP-specific UI | Low -- Firebase + DOM |
| **UI Controller** (`auth-ui/ui-controller.js`) | Panel/modal management, HUD updates, notification system, online players | Low -- tightly coupled to DOM |
| **Character Selection** (`auth-ui/character-selection.js`)| Multi-character management, creation, UI flows | Low -- DOM dependent |
| **Kingdom** (`map/kingdom.js`) | District and citadel capture system | Low -- specific to map integration |
| **Monsters** (`gameplay/monsters.js`) | Extracted logic related strictly to monsters | High -- computational logic |
| **Firebase Monitor** (`firebase/firebase-monitor.js`) | Wraps Firestore reads to count and track API usage | High -- easily mocked |
| **Logger** (`core/logger.js`) | Intercepts `console.*` calls to mirror to on-screen console | Medium -- pure functional hooks |

### Data Flow

- XP uses **BigInt** everywhere. Firestore serializes BigInt as strings; `app.js` reconverts on load. All XP arithmetic must use BigInt operators.
- **Dirty-check saves** -- `gameState.js` triggers `window.triggerSave()` on mutations; `app.js` debounces these to a single Firestore write after 5s of inactivity.
- **Position sync** uses RTDB `set()` with `onDisconnect` for auto-cleanup. Position updates explicitly skip Firestore saves to avoid cost.
- **Combat reconnection** on page refresh checks both localStorage (`activePvPBattleId`) and RTDB player status (`in_combat`) to restore ongoing fights.

### Security Model

- **Admin Verification:** Admin privileges in Firestore are determined by a custom claim (`admin == true`), a hardcoded UID fallback, or a Firestore `role` field (being deprecated). *Note: Storage rules are stricter and only accept the custom claim.*
- **Protected User Fields:** The `role` and `uid` fields on user documents cannot be modified by the user.
- **Field-Level Cooldowns:** To allow client-side PvE without Cloud Functions, players can update `spawned_objects`, but rules restrict them to modifying *only* the `defeatedAt` field (must be a number).
- **Inbox Pattern:** System invites use an inbox pattern (`users/{userId}/invites`) where anyone can create a document, but only the owner can read/modify it.
- **Known Security Gaps:** 
  - `battles`, `group_invites`, `arenas`, `combats`, and `groups` in RTDB have overly broad write rules (e.g., `auth != null` without strict ownership validation). Any authenticated user can potentially tamper with these nodes.
  - GPS coordinates in RTDB only validate data type (number), lacking range bounds (-90..90, -180..180) and spoofing/teleportation detection.
  - The `isAdmin()` function still includes a recursive Firestore read fallback for role-based checks, planned for removal after full custom claims migration.

### Multi-City Support

- 6 city anchors defined (Berlin, Kyiv, Lviv, Warsaw, Prague, Vienna). The world sync subscribes to spawned objects for the nearest city and re-subscribes on city change.

---

## Testing Decisions

### What makes a good test

Tests should verify external behavior through public interfaces, not implementation details. A good test:
- Calls a public function with specific inputs and asserts outputs
- Does not depend on internal variable names or private function calls
- Survives refactoring that preserves behavior
- Tests one logical concept per test case

### Modules to test

1. **`gameState.js` -- `recalculateStats()`**: Given base attributes + equipment, verify derived stats (maxHp, derivedDamage, critChance, hitChance, dodgeChance, regenRate, interactionRadius). This is the highest-value test target because it's pure computation and drives all combat outcomes.

2. **`data.js` -- Static data integrity**: Verify all items in `ITEMS_DB` have required fields (name, icon, type, rarity, stats, requirements), all monsters in `MONSTER_LIBRARY` have required fields, all affixes referenced by monsters exist in `AFFIXES`.

3. **`battle-logic.js` -- Damage resolution**: Test zone matchup calculations, crit/hit/dodge roll outcomes, affix effects on combat math.

4. **`combat.js` -- `processFleePenalty()`**: Verify gold loss (30%), XP loss (5%), random item removal, and monster cooldown timer are applied correctly.

5. **XP/Level-up math**: Verify quadratic curve, stat point awards, BigInt arithmetic, and HP restoration on level-up.

### No existing test infrastructure

No test framework is currently configured. Manual testing is done via browser console using debug admin tools (spawn monsters, give items, add XP). The `maintenance/__test-globals.js` file audits which `window.*` functions are registered.

---

## Out of Scope

- **Server-side game logic** -- All combat resolution is client-side. Server-authoritative combat would require Cloud Functions, which is a separate architectural decision.
- **Chat system** -- No in-game text chat between players.
- **Guilds/Clans** -- Groups are temporary session-based parties, not persistent social structures.
- **Crafting system** -- Items are obtained through drops and shops only.
- **Skill/ability system** -- Combat uses the zone-attack system exclusively; no active abilities or spells.
- **iOS build** -- Only Android via Capacitor is supported currently.
- **Localization framework** -- UI text and code comments are in Ukrainian by convention; no i18n system.
- **Offline mode** -- The game requires Firebase connectivity for all core features.
- **Automated CI/CD pipeline** -- Deployment is manual via `firebase deploy`.
- **Monetization** -- No in-app purchases, ads, or premium currency.
- **Anti-cheat** -- GPS spoofing detection and client-side validation are not implemented.

---

## Further Notes

### Known Technical Debt

1. **PvP Logic** -- PvP Logic implementation includes Arenas, but permissive write rules on RTDB remain an issue.
2. **Quest System** -- `updateQuestProgress()` is a placeholder; quests are hardcoded in HTML with no dynamic progress tracking.
3. **Tax Management** -- Citadel king tax management shows "coming soon" notification.
4. **RTDB Security** -- As detailed in the Security Model, nodes like `battles` and `combats` lack proper ownership validation.
5. **Firestore Admin Check** -- The `isAdmin()` function still includes a recursive Firestore read fallback for role-based checks.
6. **Overpass API** -- POI fetching from Overpass is disabled; all world content now comes from Firestore database sync.
7. **TailwindCSS CDN** -- Full Tailwind library (~300KB) is loaded from CDN with ~5% utilization. A build step with purging would reduce this to ~10KB.
8. **Firebase Config in Source** -- API key is in `firebase-service.js`. This is standard for Firebase web apps (security relies on rules, not key secrecy) but should be noted.

### Performance Profile

- **Lighthouse Targets:** Mobile Performance Score ≥ 60, FCP < 2.5s, LCP < 4s, TBT < 300ms, CLS < 0.1.
- **Accepted Bottlenecks:** ~300KB unused Tailwind CSS and ~400KB Firebase SDK ESM imports. These large payloads and JavaScript execution times are accepted trade-offs to maintain the bundler-free architecture.
- **Startup Firestore reads**: ~15 (down from 2600+ via SyncEngine caching). SyncEngine prioritizes downloading pre-generated JSON bundles from Firebase Storage before falling back to queries.
- **Main JS modules**: ~7,500 lines across key files (e.g. `firebase-service.js` is now ~101KB / 2800 lines in the `firebase/` directory).
- **Save strategy**: Debounced 5s writes to Firestore; position updates via RTDB only.

### City Coverage

Currently 6 city anchors: Berlin (default), Kyiv, Lviv, Warsaw, Prague, Vienna. Adding new cities requires adding entries to `CITY_ANCHORS` in `data.js` and running admin world-generation tools to populate Firestore with spawned objects.

---

## Global Territory System (v2)

### Overview
FightCraft v2 replaces the static 6-city model with a procedurally discovered global world. Any coordinate on Earth resolves to a territory owner via the **Weighted Voronoi (Power Diagram)** system.

### Core Formula
```
EffectiveDistance = HaversineDistance(player, citadel) / CitadelPower
```
The citadel with the lowest `EffectiveDistance` owns any given point. This is computed client-side with zero Firestore reads.

### Discovery System
- **Trigger**: Player enters a new H3 Resolution 6 cell (~3.2km edge)
- **Action**: Overpass API queries OSM for historic landmarks (castles, monuments, ruins, cathedrals, etc.)
- **Result**: New castle documents are created in Firestore with default `powerMultiplier: 1.0`
- **Dedup**: 100m radius prevents duplicate castles for the same landmark

### Castle Types (from OSM classification)
| Type | OSM Source | Icon |
|------|-----------|------|
| Fortress | `historic=castle/fort/citadel` | 🏰 |
| Ruins | `historic=ruins` | 🏚️ |
| Monument | `historic=monument/memorial` | 🗽 |
| Temple | `amenity=place_of_worship`, `building=cathedral/church` | ⛪ |
| Landmark | `tourism=attraction` | 🏛️ |
| Outpost | Other qualifying features | 🏕️ |

### Territory Rendering
- **Canvas overlay**: HTML5 Canvas layer on Leaflet map (pointer-events: none)
- **Boundary computation**: Ray-casting from each citadel (24 rays, 30km max range)
- **Binary search refinement**: 15-step binary search per ray for sub-meter accuracy
- **Fill**: Semi-transparent faction colors (opacity: 0.15)
- **Borders**: Solid faction color lines (opacity: 0.7, width: 2px)

### Contested Zones
A point is "contested" when the 2nd-nearest citadel's effective distance is within 15% of the 1st-nearest. Contested zones trigger visual indicators and may affect gameplay (e.g., increased PvP encounters).

### New Modules
| Module | Path | Purpose |
|--------|------|---------|
| territory-math.js | www/core/ | Pure math: haversine, getOwner, boundary estimation |
| discovery-service.js | www/core/ | H3 cell entry → OSM query → castle creation |
| territory-canvas.js | www/map/ | Canvas overlay for territory visualization |

### Preserved Systems
- **Combat math** (battle-logic.js): Untouched
- **BigInt XP**: All XP/gold operations remain BigInt-safe
- **Passive income**: districts.js tax logic preserved, uses new getOwner fallback
- **Save system**: triggerSave() debounce pattern unchanged

### Migration Status
- [x] territory-math.js — Pure math functions (TDD tested)
- [x] discovery-service.js — H3 discovery with Overpass integration
- [x] territory-canvas.js — Canvas rendering layer
- [x] territory-service.js — Refactored to delegate to territory-math
- [x] districts.js — Dual-path: polygon first, territory-math fallback
- [x] map.js — Canvas layer + discovery wired into movement
- [x] h3-spatial.js — H3_RES_DISCOVERY constant added
- [x] data.js — CITY_ANCHORS deprecated
- [ ] Firebase rules — Update for castle collection
- [ ] Full CITY_ANCHORS removal — After all callers migrated
