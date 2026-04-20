# FightCraft: System Requirements Certificate (Tech Spec)
*Version: 1.1 — Updated 2026-04-20*

## 1. Overview
FightCraft is a mobile-first, geolocation RPG that allows players to explore a real-world Leaflet-based map, fight PvE monsters, capture territories, and engage in real-time PvP combat. The system operates on a serverless architecture utilizing Firebase for all backend services and Vanilla JS/HTML5 bundled via Capacitor for Android native support.

## 2. Frontend Architecture (Vanilla JS)
The client application (`www/`) uses a strict vanilla JavaScript structure composed of ES6 modules to bypass the overhead of heavy frameworks. IndexedDB-based caching guarantees high performance on mobile devices by reducing Firestore reads by ~99.6%.

### Directory Structure:
- `/core/`: Application initialization (`app.js`), state management (`gameState.js`), window-global function registry (`bridge.js`), console interceptor (`logger.js`), and runtime diagnostics.
- `/auth-ui/`: Authentication UI (`login.html`), character selection flow (`character-selection.js`, `character-selection-ui.html`), panel/modal/HUD management (`ui-controller.js`), and dynamic HTML template injection (`ui-loader.js`).
- `/firebase/`: Firebase integration — all CRUD operations, auth, RTDB subscriptions (`firebase-service.js` — 103KB), read/write monitoring (`firebase-monitor.js`), and database usage tracking.
- `/gameplay/`: Core game loop — combat system (`combat.js` — 64KB), extracted combat math (`battle-logic.js`), PvP system (`pvp.js`), static databases (`data.js`), monster generation (`monsters.js`), group/party system (`groups.js`), IndexedDB caching layer (`sync-engine.js` — 27KB), and world generation.
- `/map/`: Leaflet.js map implementation (`map.js` — 48KB), geographic districts (`districts.js`), citadel/kingdom capture system (`kingdom.js`), POI rendering (`poi.js`), and territory management.
- `/maintenance/`: 25 admin and utility scripts — admin panels, Firestore backup/restore, database cleanup, static bundle generation, test utilities.

### Module Loading:
Entry point is `www/core/index.html` (~1100 lines). The loading sequence:
1. External libraries (Leaflet, Turf.js, TailwindCSS CDN, MarkerCluster)
2. `auth-ui/ui-loader.js` (regular script) — injects HTML templates into the DOM
3. `core/app.js` (ES6 module, `type="module"`) — orchestrates init: Firebase auth → character selection → GPS → map → world sync

## 3. Backend Architecture (Firebase)
Server-authoritative logic relies on strict security rules bridging Firestore (persistent game world) and Realtime Database (ephemeral location and combat sync). All three rule files are in the `firebase/` directory.

### 3.1. Cloud Firestore (World State)
Firestore serves as the system of record for the persistent game state.
- **`/users/{uid}`**: Player profiles, metadata, character subcollections (`/characters/{charId}`), and private invites (`/invites/{inviteId}`). Restricted to self-writes with protected fields (`role`, `uid`).
- **`/spawned_objects/{objectId}`**: Instantiated monsters, shops, and castles on the map. Contains a `defeatedAt` cooldown variable which is the only client-writable property, enforcing spawn tracking.
- **`/world_chunks/{chunkId}` & `/world_metadata/{docId}`**: Compressed binary payloads for rapid city zone loading without expensive parallel queries. Read-only to clients.
- **`/templates/{templateId}`**: Monster, shop, and castle templates for world generation. Admin-writable only.
- **`/combats/{combatId}`**: Combat records with participant-restricted updates.
- **`/castles/{castleId}`**: Persisted territorial data. Admin-writable only.
- **`/city_zones/{cityId}`**: City zone definitions. Admin-writable only.
- **`/world_snapshots/{snapshotId}`**: World state snapshots. Admin-writable only.
- **`/players/{playerId}`**: Legacy collection — being deprecated.

### 3.2. Realtime Database (RTDB) — Multiplayer
The Realtime Database is leveraged purely for high-frequency synchronization.
- **`live_players/{charId}`**: GPS position tracking (`lat`, `lng`), online status, level, and combat state. Owner-only writes validated via `userId` field.
- **`battle_requests/{battleId}`**: PvP matchmaking handshakes. Creator or participant writes only.
- **`battles/{battleId}`**: Real-time PvP turn synchronization (rounds, player choices, results). ⚠️ Overly permissive writes.
- **`combats/{combatId}`**: Live PvE/group combat instances. ⚠️ Partially restricted.
- **`groups/{groupId}`**: Ephemeral party systems. ⚠️ Partially restricted.
- **`group_invites/{targetCharId}`**: Group invitation delivery. ⚠️ Any authenticated user can write.
- **`arenas/{arenaId}`**: 50m combat boundary zones rendered on the map. ⚠️ Any authenticated user can write.
- **`players/{uid}`**: Legacy player data mirror. Owner-only writes.

### 3.3. Firebase Storage (Static Bundles)
- **`/bundles/{fileName}`**: Pre-generated JSON bundles for the SyncEngine optimization layer. Read: any authenticated user. Write: admin (custom claim only — strictest security).

## 4. Design System (Penpot Integration)
FightCraft utilizes Penpot to manage UI synchronization across the development team, strictly adhering to tokenized properties matching the CSS utility classes.

### 4.1 Token Sets
- `colors`: 37 localized color rules ensuring semantic parity (`color.bg.primary`, `color.semantic.mana`, `color.rarity.epic`).
- `spacing` & `sizing`: Strict gap variables mapping (`spacing.sm`, `sizing.slot.md`).
- `borderRadius`, `fontSizes`, `opacity`: Consistent text scaling.
- Grid system: 8px base grid alignment.

### 4.2 Component Architecture
Components are structured into distinct interactive segments:
- **Combat HUD**: Bottom-aligned `Action_Bar` with 8 distinct slot instances (`Default`, `Empty`, `Equipped`). Top-aligned statistical progress bars (`HP`, `XP`, `Mana`). Actions triggered by `Action` and `Secondary` button variants.
- **Inventory/Overlay Menus**: Configurable 4x4 Grid models overlapping a central `Menu` component, structured to inject badge attachments such as `Legendary`, `Epic`, `Rare`, `Uncommon`, `Common` inside `Slot_Wrapper` instances visually validating loot tiers.

## 5. Security & Build Flow
- **Admin Verification**: 3-tier system — custom claim (`admin == true`), hardcoded UID fallback, Firestore role field (legacy). Storage rules only accept custom claim.
- **Deploy Safety**: Commits are validated through the `deploy-check` agent skill auditing Firebase Rules against restrictive access policies (disallowing global writes, verifying UIDs).
- **Mobile Distribution**: Uses `capacitor-build` skill to sync `www/` payload directly to the Android Studio wrapper (`android/`), targeting production builds via Gradle assemble tasks.
- **Android Config**: Package `com.fightcraft.game`, HTTPS scheme, splash screen (#1a1a2e background, spinner #8b5cf6).

## 6. Performance Profile
- **Startup reads**: ~15 Firestore reads (down from 2600+ via SyncEngine + IndexedDB caching)
- **Save strategy**: Debounced 5s writes to Firestore; position updates via RTDB only
- **Accepted bottlenecks**: ~300KB unused TailwindCSS + ~400KB Firebase SDK ESM imports
- **Main JS**: ~10,000 lines across 6 key modules
- **Lighthouse targets**: Mobile Performance ≥ 60, FCP < 2.5s, LCP < 4s, TBT < 300ms, CLS < 0.1
