# ⚔️ FightCraft — Geolocation PvP RPG

A mobile geolocation RPG with real-time PvP combat. Explore the real world, fight monsters, challenge other players, and capture territories!

**🌐 Live:** [fight-craft-3c3f0.web.app](https://fight-craft-3c3f0.web.app)

---

## ✨ Core Features

- 🗺️ **Geolocation Map** — Leaflet-based map with real player GPS coordinates
- ⚔️ **PvE Combat** — Zone-based combat system (head/body/belt/legs) against monsters
- 🤺 **PvP Combat** — Challenge and fight other players in real-time (Firebase RTDB)
- 👥 **Multiplayer** — See other players on the map, online list, position synchronization
- 🏰 **Castles & Citadels** — Capture and control territories for passive income
- 🎒 **Inventory & Equipment** — Weapons, armor, potions across 7 equipment slots
- 📊 **Character Progression** — Levels, 6 base stats, derived stats, stat point allocation
- 👥 **Group System** — Form parties with nearby players for cooperative combat

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES6+ Modules) |
| **UI Framework** | TailwindCSS (CDN) |
| **Map** | Leaflet.js + MarkerCluster + Turf.js |
| **Backend** | Firebase (Auth, Firestore, RTDB, Storage, Hosting) |
| **PvP Sync** | Firebase Realtime Database |
| **Mobile** | Capacitor.js (Android) |
| **Optimization** | Static Bundles + IndexedDB SyncEngine (99.6% Firestore read reduction) |

---

## 📁 Project Structure

**Strict Project Structure Rule:** NO stray files are allowed in the project root. Every new file MUST go into its designated folder. Temporary files, test scripts, patch files, or loose documentation are strictly prohibited in the root directory.

```
FightCraft/
├── firebase.json            ← Firebase configuration
├── package.json             ← Dependencies
├── firestore.rules          ← Firestore Security Rules
├── database.rules.json      ← RTDB Security Rules
├── storage.rules            ← Storage Security Rules
├── capacitor.config.json    ← Capacitor configuration
├── CLAUDE.md                ← AI agent project context
├── docs/                    ← Documentation
│   ├── proposals/           ← RFCs and architecture proposals
│   ├── reports/             ← Analysis and progress reports
│   ├── tasks/               ← Ongoing task records
│   ├── PRD.md               ← Product Requirements Document
│   ├── SRC.md               ← System Requirements Certificate (Tech Spec)
│   └── DEV-QUICK-REFERENCE.md ← Developer quick reference
├── scripts/                 ← Node/Bash utility scripts
│   ├── generators/          ← Data generators
│   ├── diagnostics/         ← Playwright diagnostic tools
│   ├── patches/             ← Temporary patches and fix scripts
│   └── tests/               ← Testing scripts and play logic
├── www/                     ← 🌐 Web app (Firebase Hosting)
│   ├── index.html           ← Redirect to /core/index.html
│   ├── manifest.json        ← PWA manifest
│   ├── css/style.css        ← Custom styles
│   ├── assets/              ← Static assets (images, icons)
│   ├── core/                ← Application core
│   │   ├── index.html       ← Main UI (the real entry point, ~1100 lines)
│   │   ├── app.js           ← Entry point + initialization sequence
│   │   ├── bridge.js        ← Window-global function registry for onclick handlers
│   │   ├── gameState.js     ← In-memory game state singleton
│   │   ├── logger.js        ← Console interceptor → on-screen debug console
│   │   ├── diagnostics.js   ← Runtime diagnostics
│   │   ├── capacitor.js     ← Capacitor integration stub
│   │   └── geometry-utils.js← Spatial calculation helpers
│   ├── auth-ui/             ← Authentication & UI
│   │   ├── login.html       ← Login page
│   │   ├── character-selection-ui.html ← Character picker template
│   │   ├── character-selection.js ← Multi-character management
│   │   ├── ui-controller.js ← Panel/modal/HUD management (~77KB)
│   │   ├── ui-loader.js     ← Dynamic HTML template injection
│   │   └── ui.js            ← UI utilities
│   ├── firebase/            ← Firebase integration
│   │   ├── firebase-service.js ← All Firebase CRUD, auth, RTDB (~103KB)
│   │   ├── firebase-monitor.js ← Firestore read/write counter
│   │   ├── db-usage.js      ← Database usage tracking
│   │   └── emergency-monitor.js ← Emergency monitoring
│   ├── gameplay/            ← Game mechanics
│   │   ├── combat.js        ← PvE combat system (~64KB)
│   │   ├── battle-logic.js  ← Extracted combat math (pure functions)
│   │   ├── pvp.js           ← PvP system (RTDB sync, leaderboards)
│   │   ├── data.js          ← Static item/monster/city databases
│   │   ├── monsters.js      ← Monster generation logic
│   │   ├── groups.js        ← RTDB-synced party system
│   │   ├── sync-engine.js   ← IndexedDB caching layer (~27KB)
│   │   ├── generation-service.js ← World object generation
│   │   └── gameplay_*.html  ← Admin gameplay templates (6 files)
│   ├── map/                 ← Map & geography
│   │   ├── map.js           ← Leaflet map, markers, fog of war (~48KB)
│   │   ├── districts.js     ← Geographic district system
│   │   ├── kingdom.js       ← Citadel capture system
│   │   ├── poi.js           ← Points of Interest
│   │   ├── overpass-service.js ← Overpass API integration (disabled)
│   │   ├── territory-service.js ← Territory management
│   │   └── templates_map.html ← Map UI templates (~66KB)
│   └── maintenance/         ← Admin & utility tools (25 files)
│       ├── admin.html       ← Admin panel
│       ├── admin-*.js       ← Admin modules (monsters, shops, castles, etc.)
│       ├── backup-*.js      ← Firestore backup/restore tools
│       └── *-cleanup.js     ← Database cleanup utilities
├── android/                 ← Android build (Capacitor)
├── firebase/                ← Firebase rules directory
└── .agents/                 ← AI agent DOE orchestration system
    ├── INSTRUCTIONS.md      ← Orchestration kernel
    ├── directives/          ← Natural language SOPs
    ├── execution/           ← PowerShell automation scripts
    ├── protocols/           ← Self-annealing & parallel review
    ├── rules/               ← Always-on agent rules (ACR system)
    ├── skills/              ← 13 agent skills (5 custom + 8 community)
    └── env/                 ← Sensitive data isolation (.env)
```

---

## 🚦 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run locally (Firebase Hosting Emulator)
npx firebase serve --only hosting --port 5000

# 3. Open in browser
# http://localhost:5000

# 4. Deploy to production
npx firebase deploy --only hosting
```

---

## 🎮 Gameplay

### Combat System
Zone-based combat with 4 attack/defense zones:
- 🎯 **Head** — High damage, hard to hit
- 💪 **Body** — Balanced zone
- 🔗 **Belt** — Fast attacks
- 🦵 **Legs** — Reduces mobility

Defense covers 2 adjacent zones simultaneously (Head+Body, Body+Belt, Belt+Legs, Head+Legs).

### Character Stats
- **6 Base Attributes:** Strength, Agility, Intuition, Vitality, Intellect, Wisdom
- **Derived Stats:** Health, Damage, Crit, Hit Chance, Dodge, Regen, Vision Radius
- **5 stat points** per level, quadratic XP curve (500 × level²)
- **XP stored as BigInt** for future-proof large-number support

### Equipment
- **7 Slots:** Helmet, Armor, Shield, Sword, Boots, Gloves, Belt
- **4 Rarity Tiers:** Common, Uncommon, Rare, Epic
- Items have stat requirements gating equipment access

### PvP
- Challenge a player via the online players panel or their map marker
- Real-time combat synced through Firebase RTDB
- Results: **Victory / Defeat / Draw** (draw restores 30% HP)
- PvP statistics tracked on player profiles
- 50m combat arena boundary — leaving causes auto-defeat
- Auto-reconnect on page refresh via localStorage + RTDB

### Groups
- Create parties and invite nearby players
- Group combat: unified Team A vs Team B via RTDB
- Proximity checks: all members must be within 50m of the target

### Territory
- **Procedural Global World:** Powered by H3 spatial indexing and OpenStreetMap, generating the world wherever you go.
- **Pre-generated World Data:** City boundaries and POIs are pre-fetched via Node scripts to avoid rate-limiting Overpass API. Run `node scripts/generators/fetch-city-boundaries.js` and `node scripts/generators/fetch-city-pois.js` to build `www/gameplay/world_cities_boundaries.json` and `www/gameplay/world_cities_pois.json`.
- **Auto-Discovery:** Landmarks (castles, monuments, ruins) are automatically discovered and spawned immediately upon logging in and as you explore.
- City districts with citadels that can be captured when within 50m
- District kings earn passive hourly gold income
- Safe storage system at citadels to protect resources

### Firestore Optimization
- **99.6% read reduction** on initialization (from 2600+ to ~15 reads)
- Static Bundles strategy with IndexedDB caching via SyncEngine
- Debounced saves (5s after last change) instead of periodic writes

---

## 📱 Mobile Build (Android)

```bash
# Sync with Capacitor
npx cap sync android

# Open in Android Studio
npx cap open android

# Build debug APK
npm run android:build

# Build release AAB
npm run android:release
```

---

## 🔐 Firebase Security

Security rules are configured in:
- `firestore.rules` — Firestore access control (user profiles, characters, game objects)
- `database.rules.json` — RTDB access control (live players, battles, groups)
- `storage.rules` — Storage access control (static bundles)

### Security Model
- **Admin verification:** Custom claim (`admin == true`) + hardcoded UID fallback
- **Protected fields:** `role` and `uid` on user documents cannot be self-modified
- **Field-level cooldowns:** Players can only modify `defeatedAt` on spawned objects
- **Inbox pattern:** System invites use `users/{userId}/invites` collection

> ⚠️ **Known gaps:** Some RTDB nodes (`battles`, `combats`, `arenas`, `groups`) have overly permissive write rules. GPS coordinate validation lacks range bounds and spoofing detection. See [PRD.md](docs/PRD.md) for full details.

---

## 🌍 Multi-City Support

6 city anchors: Berlin (default), Kyiv, Lviv, Warsaw, Prague, Vienna.  
Adding new cities requires entries in `CITY_ANCHORS` (data.js) + admin world-generation tools.

---

## 🤖 AI Agent Systems

Two parallel AI agent systems for development:

| System | Location | Purpose |
|--------|----------|---------|
| **Claude Code Agents** | `.claude/agents/` | Specialized agents for Claude Code teammate mode |
| **Antigravity DOE** | `.agents/` | Directive → Orchestration → Execution architecture |

See [CLAUDE.md](CLAUDE.md) for full agent documentation.

---

*Version: v0.5.0 | Last updated: 2026-04-20*
