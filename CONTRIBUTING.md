# Contributing to FightCraft

Welcome to **FightCraft** — a geolocation RPG built as a bundler-free HTML5 web app backed by Firebase. This guide is written for developers who use AI coding assistants (Copilot, Claude, Cursor, etc.) as part of their workflow.

> **TL;DR**: Write tests first. Use BigInt for all math. Don't install a bundler. Run the tests before pushing.

---

## 🏗️ Architecture Quick Reference

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Vanilla JS (ES6 modules) | Served directly via Firebase Hosting. **No bundler.** |
| **Backend** | Firebase Auth + Firestore + RTDB + Storage | Security Rules act as the "server". No Cloud Functions in prod. |
| **Mobile** | Capacitor (Android only) | Wraps the web app in a native WebView. |
| **Testing** | Vitest | All test infrastructure lives in `/tests`. Production code is untouched. |

### Module Map

```
www/
├── core/           # gameState.js (singleton), app.js (init + save), bridge.js, logger.js
├── gameplay/       # combat.js, battle-logic.js, data.js, pvp.js, groups.js, monsters.js
├── map/            # map.js (Leaflet), kingdom.js, districts.js, poi.js
├── firebase/       # firebase-service.js (~2800 lines), firebase-monitor.js
├── auth-ui/        # ui-controller.js, character-selection.js
├── maintenance/    # Debug/admin utilities
├── css/            # Stylesheets
└── assets/         # Static images, icons
```

---

## 🚨 Critical Rules for AI-Assisted Development

These rules **MUST** be included in every AI prompt you write. Copy-paste the relevant block into your AI assistant's context:

### Rule 1: BigInt for ALL XP and Game Math

```
⚠️ MANDATORY AI CONTEXT:
This project uses BigInt for ALL XP and game math calculations.
- XP is stored as BigInt: `gameState.player.xp = BigInt(0)`
- Firestore serializes BigInt as strings; we reconvert on load.
- ALL XP arithmetic MUST use BigInt operators: +, -, *, **, >=, <=
- NEVER use standard Number for XP. It loses precision above 2^53.
- XP curve: xpToNext = BigInt(500 * level * level)
- Example: `player.xp = BigInt(player.xp) + BigInt(Math.floor(amount))`
```

### Rule 2: No Bundler in `/www`

```
⚠️ MANDATORY AI CONTEXT:
The /www directory is bundler-free. JavaScript files are served
directly as ES6 modules via Firebase Hosting.
- Do NOT attempt to install Webpack, Vite, Rollup, esbuild, or any
  build tool that modifies the /www directory.
- Do NOT add import maps, barrel files, or transpilation steps.
- External libraries are loaded via CDN <script> tags in index.html.
- The `package.json` build script is intentionally: "echo 'No build needed'"
```

### Rule 3: `window.bridge` Pattern

```
⚠️ MANDATORY AI CONTEXT:
This project uses window.* globals for UI-to-JS communication.
HTML onclick handlers call functions on `window` (e.g., window.selectAttackZone).
These are registered in bridge.js or inline in module files.
Do NOT refactor these to event listeners without explicit approval.
```

---

## ✅ Standardized Testing

### All new logic MUST have tests

Every Pull Request that introduces or modifies game logic **must** include corresponding tests in `/tests` before submission. UI-only changes (CSS, HTML layout) are exempt.

### Test File Location

```
tests/
├── vitest.config.js    # Vitest configuration (node + happy-dom environments)
├── setup.js            # Global test setup (mocks browser globals + Firebase)
├── mocks.js            # Mock factories (Firebase, browser, player/monster fixtures)
├── browser-mocks.js    # Browser-specific mocks (Geolocation, Leaflet, Toast, RTDB)
├── core-logic.test.js  # Core game logic tests (node env)
└── integration.test.js # UI & integration tests (happy-dom env)
```

### Running Tests

```bash
# Run all tests
npx vitest run --config tests/vitest.config.js

# Run in watch mode (during development)
npx vitest --config tests/vitest.config.js

# Run a specific test file
npx vitest run --config tests/vitest.config.js tests/core-logic.test.js
```

### Writing New Tests

1. **Create your test file** in `/tests` with the `.test.js` extension.
2. **Import from production code** using the `@www` alias:
   ```js
   import { recalculateStats } from '@www/core/gameState.js';
   ```
3. **Use mocks** from `mocks.js` for test fixtures:
   ```js
   import { createMockPlayer, createMockMonster } from './mocks.js';
   ```
4. **Mock side-effectful modules** that aren't relevant to your test:
   ```js
   vi.mock('@www/firebase/firebase-service.js', () => mockFirebaseService());
   ```
5. **Test BigInt operations explicitly**:
   ```js
   expect(typeof player.xp).toBe('bigint');
   expect(player.xp).toBe(500n); // Use n suffix for BigInt literals
   ```

### What to Test

| Priority | Module | Why |
|----------|--------|-----|
| 🔴 High | `core/gameState.js` | Pure computation, drives all combat |
| 🔴 High | `gameplay/data.js` | Static data integrity |
| 🔴 High | `gameplay/battle-logic.js` | Combat math, zone matching |
| 🟡 Medium | `gameplay/combat.js` | Flee penalty, damage calc (extract pure functions) |
| 🟡 Medium | `gameplay/monsters.js` | Spawn logic |
| 🟡 Medium | `auth-ui/ui-controller.js` | Notifications, HUD updates, XP bar |
| 🟢 Low | `firebase/firebase-service.js` | Side-effectful, requires integration tests |
| 🟢 Low | `map/map.js` | DOM + Leaflet dependency |

### 🔘 "Button-First" Testing (Mandatory)

Every new button added to the HUD or any in-game Menu **MUST** have a corresponding integration test in `/tests/integration.test.js` that verifies:

1. **Click simulation**: The button's `onclick` / event handler is triggered.
2. **State mutation**: The expected change to `gameState` or the DOM occurs.
3. **Notification output**: The correct toast message is displayed (or event logged).

```js
// Example: testing a new "Meditate" button
it('Meditate button restores 10% HP and shows toast', () => {
  gameState.player.hp = 50;
  gameState.player.maxHp = 100;

  document.getElementById('btn-meditate').click();

  expect(gameState.player.hp).toBe(60); // +10%
  const notifs = document.querySelectorAll('.notification');
  expect(notifs[notifs.length - 1].textContent).toContain('Meditate');
});
```

> **No button ships without a test.** If a PR adds a button to the HTML but lacks a test in `/tests/integration.test.js`, it must be rejected.

### 🤖 AI Integration Instruction

When using an AI coding assistant to add new UI elements, **always** include this instruction in your prompt:

```
When adding UI elements, update bridge.js and add an integration
test in /tests/integration.test.js to verify the button's output message.
The test must:
1. Scaffold the required DOM element in scaffoldCombatDOM() or a new scaffold.
2. Simulate the user action (click, tap).
3. Assert the expected gameState change and notification toast text.
4. Use browser-mocks.js for Geolocation, Leaflet, or RTDB stubs if needed.
```

This ensures every UI interaction has automated coverage from day one.

---

## 📋 Contribution Workflow

### 1. Understand the Task

- Read the [PRD](docs/PRD.md) for feature context and game mechanics.
- Read [CLAUDE.md](CLAUDE.md) for codebase architecture and conventions.
- Check existing tests in `/tests` for patterns.

### 2. Write Tests First (TDD Encouraged)

```bash
# Start Vitest in watch mode
npx vitest --config tests/vitest.config.js

# Write your test → see it fail (red)
# Implement the feature → see it pass (green)
# Refactor → keep it passing (refactor)
```

### 3. Implement & Verify

```bash
# Ensure all tests pass
npx vitest run --config tests/vitest.config.js

# If you modified Firebase Rules, validate them:
# (requires firebase CLI and active project)
npx firebase deploy --only firestore:rules --dry-run
```

### 4. Pre-Push Checklist

- [ ] `npx vitest run --config tests/vitest.config.js` — **all tests green**
- [ ] No `Number()` used for XP arithmetic (use `BigInt()`)
- [ ] No bundler or build tool added to `/www`
- [ ] No new `window.*` globals without documenting in `bridge.js`
- [ ] **New buttons have an integration test** in `tests/integration.test.js`
- [ ] Firebase Security Rules updated if data schema changed
- [ ] Comments in code for non-obvious logic (especially combat math)

---

## 🤖 AI Prompting Best Practices

When using an AI assistant on this project, **always** include these instructions in your prompt:

```
Project-specific context for AI:
1. This project uses BigInt for all XP and math. Do NOT use standard Numbers for game logic.
2. Architecture is bundler-free ESM. Do NOT install build tools (Webpack/Vite/Rollup) for /www.
3. All tests go in /tests, NOT alongside production code.
4. Use vi.fn() and vi.mock() from Vitest for test mocking.
5. Firebase services are mocked in tests — see tests/mocks.js for the mock factory.
6. Game state is a singleton exported from www/core/gameState.js.
7. The window.triggerSave() pattern uses a 5-second debounce for Firestore writes.
8. The saveGame() function serializes BigInt to string before writing to Firestore.
```

### Common AI Mistakes to Watch For

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| `player.xp += reward` | Number addition loses BigInt | `player.xp = BigInt(player.xp) + BigInt(reward)` |
| `npm install webpack` | Breaks bundler-free arch | Don't. Files are served as-is. |
| Test files in `www/__tests__/` | Pollutes production code | Put in `/tests/` |
| `import firebase from 'firebase'` | Wrong import style | Use `import { ... } from '../firebase/firebase-service.js'` |
| `document.getElementById` in tests | Tests run in Node | Use mocks from `tests/mocks.js` |

---

## 📁 File Naming Conventions

- **Production code**: `kebab-case.js` in appropriate `www/` subdirectory
- **Test files**: `<feature>.test.js` in `/tests/`
- **Firebase Rules**: `firestore.rules`, `database.rules.json`, `storage.rules` in `/firebase/`

---

## 🔐 Security Considerations

- **Never trust the client**. All critical validations must exist in Firebase Security Rules.
- **Admin checks** use Firebase custom claims (`admin == true`), not client-side flags.
- **GPS coordinates** in RTDB are validated for type but not range — contributions improving this are welcome.
- **API keys** in `firebase-service.js` are standard Firebase web config (security relies on rules, not key secrecy).

---

## 📞 Getting Help

- **PRD**: [`docs/PRD.md`](docs/PRD.md) — Full product requirements
- **Architecture**: [`CLAUDE.md`](CLAUDE.md) — Technical deep-dive
- **Codebase**: [`docs/SRC.md`](docs/SRC.md) — Source reference
- **Balance**: Run the `game-balance` skill for item/monster audits

---

*Last updated: 2026-04-20*
