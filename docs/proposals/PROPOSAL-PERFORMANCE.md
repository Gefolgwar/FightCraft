# Performance Audit — FightCraft

**Date:** 2026-05-03  
**Auditor:** perf-reviewer agent  
**Scope:** Full client-side performance, Firebase cost analysis, memory management, rendering efficiency

---

## Executive Summary

FightCraft has made significant progress in Firebase cost optimization (down from 2,600+ reads to ~15 at startup via SyncEngine + IndexedDB), but several critical issues remain:

1. **`isAdmin()` always returns `true`** — Line 266 of `firebase-service.js` has `return true;` before the real logic. Every user runs admin-only codepaths (collectionGroup queries, test player loading, world snapshots), inflating reads by 3-10x per session.
2. **`recalculateStats()` called every second** — The 1s regen loop calls `recalculateStats()` unconditionally, which iterates all equipment, recomputes derived stats, and triggers `triggerSave()` (a debounced Firestore write). This generates ~60 save triggers per minute even when nothing changes.
3. **640KB static data file** — `world_cities.js` (35,538 lines) is loaded eagerly as an ES6 module import, blocking first-paint even if not immediately needed.
4. **RTDB listeners on `battle_requests/` are never detached** — `subscribeToBattleRequests()` attaches `onChildAdded` + `onChildChanged` to the entire `battle_requests` node and the returned unsubscribe function is never called.
5. **`experimentalForceLongPolling: true`** — Forces Firestore to use XHR long-polling instead of WebSocket/streaming, significantly increasing latency and battery drain on mobile.

**Estimated Impact:**
- Fixing the `isAdmin()` bug alone would reduce Firestore reads by 40-60% per session for non-admin users.
- Fixing the regen loop would eliminate ~60 unnecessary `triggerSave()` calls and ~60 `recalculateStats()` calls per minute.
- Lazy-loading `world_cities.js` could save ~500ms on initial page load.

**Risk Level: High**

---

## Firebase Cost Analysis

### Startup Read Budget (Current)

| Operation | Reads | Source |
|-----------|-------|--------|
| `initFirebase()` -> user profile | 1 (or 0 if cached) | `firebase-service.js:187` |
| `SyncEngine.syncWorld()` -> world_metadata check | 1 | `sync-engine.js:97` |
| SyncEngine -> IndexedDB hit (cache valid) | 0 | `sync-engine.js:132` |
| SyncEngine -> Full sync fallback (cache miss) | N (all spawned_objects) | `sync-engine.js:295` |
| `getTemplates('monster')` | Varies (cached after first) | `firebase-service.js` |
| `getTemplates('shop')` | Varies (cached after first) | `firebase-service.js` |
| `getTemplates('castle')` | Varies (cached after first) | `firebase-service.js` |
| `subscribeToWorldMetadata()` | 1 (initial snapshot) | `firebase-service.js:1673` |
| `getWorldSnapshots()` (**admin only but runs for all due to bug**) | N (all snapshots) | `firebase-service.js` |
| `getAllPlayersForDebug()` (**admin-only but runs for all due to bug**) | N (all characters via collectionGroup) | `firebase-service.js:747` |
| **Typical startup (normal user, cache hit)** | **~3-5** | |
| **Actual startup (isAdmin() bug)** | **~15-50+** | |

### Per-Action Read Costs

| Action | Reads | Notes |
|--------|-------|-------|
| `fetchLeaderboard()` | N (all characters via collectionGroup) | `firebase-service.js:926` — scans ALL characters |
| `subscribeToPlayers()` (Firestore) | N (all characters via collectionGroup) | Admin-only but bypassed by bug |
| `saveGame()` | 0 reads, 1 write | Debounced 5s |
| `updateSpawnedObject()` (monster defeat) | 0 reads, 1 write | Write-through cache |
| `claimCastle()` | 0 reads, 2 writes | Castle + spawned_object update |
| Position update (RTDB) | 0 reads | RTDB `update()` only |

### Cost Drivers (Priority Order)

#### 1. `isAdmin()` Always Returns `true` (CRITICAL BUG)

**Location:** `firebase-service.js:266`
```javascript
export function isAdmin() { return true;
  return userRole && userRole.toLowerCase() === "admin";
}
```

**Impact:** Every user executes admin-only paths:
- `loadTestPlayersToMap()` -> `getAllPlayersForDebug()` -> `collectionGroup('characters')` -> N reads
- `getWorldSnapshots()` -> reads all world_snapshots documents
- Admin template breakdown logging
- `subscribeToPlayers()` (Firestore collectionGroup) — skips the `!isAdmin()` guard

**Estimated cost:** 10-50 extra Firestore reads per session per user. At scale with 100 daily users, this is 1,000-5,000 wasted reads/day.

**Fix:** Remove the `return true;` on line 266.

**Severity:** CRITICAL

#### 2. `fetchLeaderboard()` Uses Unbounded `collectionGroup`

**Location:** `firebase-service.js:926`
```javascript
const q = query(collectionGroup(db, "characters"));
const snapshot = await getDocs(q);
```

**Impact:** Every time a user opens the leaderboard tab, this fetches ALL character documents across ALL users. With 100 characters, that's 100 reads per leaderboard view. No pagination, no caching, no limit.

**Fix:**
1. Add a `.limit(50)` to the query
2. Cache the result for 5 minutes in memory
3. Consider a server-side aggregation (Cloud Function or denormalized leaderboard collection)

**Severity:** WARNING

#### 3. `subscribeToSpawnedObjects()` Fallback Uses Real-time `onSnapshot`

**Location:** `firebase-service.js:1629`

When the in-memory cache is empty, this falls back to a real-time listener on `spawned_objects` filtered by `cityId`. Each update from ANY user (e.g., defeating a monster updates `defeatedAt`) triggers a read cost for ALL listening clients.

**Fix:** The `fetchSpawnedObjectsOnce()` -> SyncEngine path is correct and already preferred. Ensure the fallback never triggers by pre-populating the cache.

**Severity:** WARNING

---

## Memory & Resource Analysis

### 1. Regen Loop Calls `recalculateStats()` Every Second

**Location:** `app.js:953-963`
```javascript
function updateRegeneration() {
  if (gameState.combat) return;
  const now = Date.now();
  if (now - gameState.player.lastDamageTime < 5000) return;
  const p = recalculateStats(); // <- FULL stat recomputation!
  if (p.hp < p.maxHp && p.regenRate > 0) {
    p.hp = Math.min(p.maxHp, p.hp + p.regenRate);
    updateHUD();
  }
}
```

**Issue:** `recalculateStats()` (gameState.js:78-151):
- Iterates ALL equipment slots (7 slots)
- Computes 10+ derived stats
- Calls `window.triggerSave()` at the END — which means every 1s tick queues a save

**Impact:**
- 60 unnecessary `recalculateStats()` calls per minute
- 60 `triggerSave()` calls per minute (each resets the 5s debounce timer, but the final one fires -> 1 Firestore write per 6s of idle play even with no state changes)
- CPU waste on mobile devices

**Fix:**
```javascript
function updateRegeneration() {
  if (gameState.combat) return;
  const now = Date.now();
  if (now - gameState.player.lastDamageTime < 5000) return;
  const p = gameState.player;
  if (p.hp < p.maxHp && p.regenRate > 0) {
    p.hp = Math.min(p.maxHp, p.hp + p.regenRate);
    updateHUD();
    // Only trigger save if HP actually changed
    if (window.triggerSave) window.triggerSave();
  }
}
```
Remove `recalculateStats()` from the loop entirely. Stats only need recalculation when equipment/attributes change.

**Severity:** CRITICAL

### 2. `recalculateStats()` Triggers `triggerSave()` Unconditionally

**Location:** `gameState.js:149`
```javascript
if (window.triggerSave) window.triggerSave();
```

This means ANY call to `recalculateStats()` — including from the 1s regen loop — queues a Firestore save, even when no stats actually changed.

**Fix:** Add dirty-checking before saving:
```javascript
// Only save if something actually changed
const newHash = fastHash(p.effective);
if (newHash !== _lastStatsHash) {
  _lastStatsHash = newHash;
  if (window.triggerSave) window.triggerSave();
}
```

**Severity:** CRITICAL

### 3. RTDB Battle Request Listeners Never Detached

**Location:** `firebase-service.js:3043-3087`

`subscribeToBattleRequests()` returns an unsubscribe function, but the caller in `pvp.js:21-25` never stores or calls it:
```javascript
m.subscribeToBattleRequests(handleBattleRequest, handleBattleStatusChange);
// No unsubscribe stored
```

**Impact:** Two persistent RTDB listeners (`onChildAdded` + `onChildChanged`) on the ENTIRE `battle_requests` node. These listeners:
- Fire for EVERY battle request from ANY player (not filtered by current user)
- Receive data for the full request object on every change
- Never get cleaned up, even on character switch

**Fix:** Store the unsubscribe in a module variable and call it in a cleanup function:
```javascript
let _battleRequestUnsub = null;

export function initPvP() {
  import('../firebase/firebase-service.js').then(m => {
    if (_battleRequestUnsub) _battleRequestUnsub();
    _battleRequestUnsub = m.subscribeToBattleRequests(
      handleBattleRequest, handleBattleStatusChange
    );
  });
}
```

**Severity:** CRITICAL

### 4. `subscribeToPlayersRTDB()` Listens to ALL Players

**Location:** `firebase-service.js:562`
```javascript
const playersRef = ref(rtdb, "live_players");
onValue(playersRef, (snapshot) => { ... });
```

This downloads the ENTIRE `live_players` node (all online players globally) on every update. With 50 online players each moving every 2 seconds, this generates ~25 snapshot updates per second, each containing all 50 players' data.

**Fix:** Use geo-hashing or regional nodes to scope the listener (e.g., `live_players/{regionId}`). Short-term: debounce the callback processing.

**Severity:** WARNING

### 5. `setupWorldSync()` Called Every 1 Second

**Location:** `app.js:537`
```javascript
setInterval(() => {
  updateRegeneration();
  processIncome();
  setupWorldSync(); // Check for city changes
}, 1000);
```

`setupWorldSync()` iterates all `CITY_ANCHORS` (6 cities) and calls `getDistance()` for each. It's guarded by a city-change check, but the distance computation still happens every second.

**Fix:** Only check on GPS position change or every 30 seconds:
```javascript
let _lastWorldSyncCheck = 0;
// In the interval:
if (Date.now() - _lastWorldSyncCheck > 30000) {
  _lastWorldSyncCheck = Date.now();
  setupWorldSync();
}
```

**Severity:** WARNING

### 6. `checkCitadelProximity()` Every 5 Seconds

**Location:** `kingdom.js:21`
```javascript
setInterval(checkCitadelProximity, 5000);
```

Computes distance to current district's citadel every 5s. Low impact, but could be event-driven (only check when player moves).

**Severity:** SUGGESTION

### 7. Document Event Listeners Without Removal

**Location:** `map.js:964-976`
```javascript
document.addEventListener("mousemove", (e) => { ... });
document.addEventListener("touchmove", (e) => { ... }, { passive: true });
document.addEventListener("mouseup", end);
document.addEventListener("touchend", end);
```

These joystick handlers are attached to `document` and never removed. In a single-page app this is tolerable, but if the map is re-initialized, these accumulate.

**Severity:** SUGGESTION

### 8. `groups.js` Has Proper Cleanup Pattern (Positive)

**Location:** `groups.js:33-37`
```javascript
export function cleanupGroups() {
    if (_groupUnsubscribe) { _groupUnsubscribe(); _groupUnsubscribe = null; }
    if (_inviteUnsubscribe) { _inviteUnsubscribe(); _inviteUnsubscribe = null; }
    if (_declineUnsubscribe) { _declineUnsubscribe(); _declineUnsubscribe = null; }
}
window.addEventListener('beforeunload', cleanupGroups);
```

This is the correct pattern. Other RTDB subscriptions should follow this model.

---

## Caching Effectiveness

### SyncEngine (sync-engine.js) — Well-Designed

The SyncEngine implements a "meta-check then cache" strategy:
1. **1 Firestore read** to check `world_metadata/current_state` for version hash
2. **If hash matches local IndexedDB** -> 0 additional reads (load from IndexedDB)
3. **If hash differs** -> attempt bundle download from Storage, then delta sync, then full sync fallback

**Strengths:**
- Hash-based invalidation avoids unnecessary full loads
- Bundle download via Firebase Storage SDK bypasses CORS
- Delta sync only fetches changed objects
- Write-through cache on `updateSpawnedObject()`

**Weaknesses:**
- No TTL-based cache expiry for templates — they're only refreshed if `_templatesCache` is explicitly cleared
- `_cityZonesCache` is populated but the `getCityZones()` call is disabled ("LEGACY: Disabled to save bandwidth")
- No cache size monitoring — IndexedDB could grow unbounded if world data increases

### localStorage Caching

| Key | Purpose | TTL | Size Risk |
|-----|---------|-----|-----------|
| `user_profile_{uid}` | User profile + role | 1 hour | Low (~1KB) |
| `fightcraft_v3` | Full game state backup | None | Medium (~10-50KB) |
| `total_firestore_reads` | Read counter | None (resets by date) | Negligible |
| `firestore_detailed_logs` | Detailed read logs | None (capped at 500 entries) | Medium (~50KB) |
| `debugModeEnabled` | Debug toggle | Permanent | Negligible |
| `lastCharacterId` | Last selected character | Permanent | Negligible |

**Risk:** The `firestore_detailed_logs` can grow to ~50KB in localStorage. Combined with `fightcraft_v3`, total localStorage usage could reach 100KB+ per session — not close to the 5MB limit but worth monitoring.

---

## Loading Performance

### CDN Dependencies (Blocking)

| Resource | Size (gzipped est.) | Blocking? | Notes |
|----------|---------------------|-----------|-------|
| TailwindCSS CDN | ~300KB raw (~73KB gzip) | **Yes** (render-blocking script) | Only ~5% utilized |
| Leaflet 1.9.4 | ~140KB raw (~39KB gzip) | **Yes** (render-blocking script) | Essential for map |
| Leaflet MarkerCluster 1.5.3 | ~30KB raw | **Yes** | Could be lazy-loaded |
| Turf.js 6.x | ~500KB raw (~130KB gzip) | **Yes** (render-blocking script) | Heavy — only distance/point-in-polygon used |
| Leaflet CSS + MarkerCluster CSS | ~15KB | Yes (CSS) | Required |
| Firebase SDK (ESM CDN) | ~200KB total (5 modules) | No (dynamic import in module) | Good — loaded on-demand |
| **Total blocking resources** | **~970KB raw** | | |

### JS Module Sizes

| File | Size | Load Impact |
|------|------|-------------|
| `world_cities.js` | **640KB** (35,538 lines) | Eagerly imported — blocks init |
| `firebase-service.js` | 108KB | Eagerly imported |
| `ui-controller.js` | 77KB | Eagerly imported |
| `combat.js` | 64KB | Eagerly imported |
| `map.js` | 63KB | Eagerly imported |
| `app.js` | 46KB | Entry point |
| `sync-engine.js` | 30KB | Imported via firebase-service.js |
| **Total eager JS** | **~1.03MB** | |

### Init Sequence (app.js)

The 18-step boot sequence has some parallelization (`Promise.all` for templates), but several steps are sequential when they could be parallel:

| Step | Duration (est.) | Parallelizable? |
|------|----------------|-----------------|
| `initFirebase()` + Auth | 1-5s | No (must be first) |
| GPS acquisition | 0-5s (5s timeout) | **Yes** (with Firestore fetches) |
| `registerPlayerInRTDB()` | 200ms | No (needs GPS) |
| `subscribeToPlayersRTDB()` | 100ms | Yes |
| `initMap()` | 300ms | No (needs GPS) |
| `fetchSpawnedObjectsOnce()` + templates | 500-2000ms | Already parallel |
| `checkAndFetchPOIs()` | 200ms | Yes |
| `initPvP()` + `initKingdom()` | 50ms | Yes |
| `initH3Territory()` | 200ms | Yes |
| `initGroups()` | 100ms | Yes |
| `subscribeToArenas()` | 100ms | Yes |
| `recalculateStats()` | 5ms | No (needs loaded data) |
| `updateHUD()` | 10ms | No (needs stats) |

**Optimization opportunity:** GPS acquisition (up to 5s timeout) blocks everything. Firebase fetches could start in parallel with GPS.

---

## Runtime Performance

### Game Loops

| Loop | Interval | Operations Per Tick | Concern |
|------|----------|-------------------|---------|
| Regen + Income + WorldSync | 1s | `recalculateStats()` (heavy), `processIncome()`, `setupWorldSync()` (6 distance calcs) | CRITICAL: `recalculateStats` should not be here |
| Citadel proximity | 5s | 1 distance calc | Acceptable |
| DB usage dashboard | 5s | DOM update | Only on admin page |
| Emergency monitor | varies | DOM overlay | Conditional |
| PvP battle request timer | 1s | UI countdown | Active only during battle request |
| PvP battle turn timer | 1s | UI countdown | Active only during combat |

### Map Rendering

**Good patterns:**
- Leaflet Canvas renderer (`L.canvas()`) for 2600+ objects — correct choice
- MarkerClusterGroup with `chunkedLoading: true` — prevents frame drops
- `disableClusteringAtZoom: 16` — avoids cluster recalculation at high zooms
- Position sync throttled at 2s with leading + trailing edge

**Concerns:**
- `renderStaticMonsters()` clears ALL markers and re-adds them (`monsterCluster.clearLayers()` -> rebuild). With 500+ monsters, this causes a visible stutter.
- Each monster marker uses `L.divIcon` with inline HTML — creates a new DOM element per marker.
- `turf.distance()` called per-monster in filter (potentially 500+ Turf calls per render)
- `updateOtherPlayers()` calls `turf.distance()` per player (up to 50 calls per update)

**Fix for rendering:**
```javascript
// Instead of clearing ALL and re-adding:
// Only add/remove/update changed markers using a Map<id, marker>
const currentIds = new Set(monstersToShow.map(m => m.id));
// Remove stale
monsterMarkers.forEach((marker, id) => {
  if (!currentIds.has(id)) monsterCluster.removeLayer(marker);
});
// Add new only
monstersToShow.forEach(m => {
  if (!markerMap.has(m.id)) { /* create and add */ }
});
```

### Data Serialization

**`saveGame()` serialization overhead (`app.js:974`):**
```javascript
const data = JSON.parse(JSON.stringify({
  ...gameState,
  combat: null,
  player: { ...gameState.player, xp: gameState.player.xp.toString(), ... },
}));
```

This does a full deep-clone via `JSON.parse(JSON.stringify(...))` of the entire gameState on every save. With large inventories or quest data, this could take 5-20ms on mobile. The `BigInt` serialization is handled correctly (toString before stringify).

**Fix:** Only serialize changed sections using a dirty-flag system.

---

## `experimentalForceLongPolling` — Hidden Performance Cost

**Location:** `firebase-service.js:127`
```javascript
db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
```

**Issue:** This forces Firestore to use XHR long-polling instead of WebSocket streaming. This was likely added to fix connectivity issues in Capacitor/WebView, but it:
- **Increases latency** by 100-500ms per operation
- **Increases battery drain** (more frequent HTTP connections)
- **Prevents multiplexing** (one connection per listener instead of shared WebSocket)

**Fix:** Test with WebSocket (remove the flag) on the Capacitor WebView. If it works, remove it. If not, consider using `experimentalAutoDetectLongPolling: true` which tries WebSocket first and falls back gracefully.

---

## Optimization Proposals

### P0: Fix `isAdmin()` Bug (Critical, <5 minutes)

**Problem:** `isAdmin()` always returns `true`, causing every user to execute admin-only codepaths including expensive collectionGroup queries.

**Solution:** Remove `return true;` from `firebase-service.js:266`.

**Expected Impact:** 40-60% reduction in Firestore reads per session for non-admin users. Eliminates `getAllPlayersForDebug()`, `getWorldSnapshots()`, `subscribeToPlayers()` (Firestore) for regular players.

**Effort:** 1 minute.

### P0: Fix Regen Loop (Critical, 15 minutes)

**Problem:** `recalculateStats()` called every 1s, each call triggers `triggerSave()`.

**Solution:** 
1. Remove `recalculateStats()` from `updateRegeneration()`
2. Use cached `regenRate` directly
3. Remove `triggerSave()` from `recalculateStats()`; callers that actually change stats should trigger saves explicitly

**Expected Impact:** Eliminate ~60 wasted `recalculateStats()` calls/minute. Reduce Firestore writes from ~10/minute to ~0/minute during idle play.

**Effort:** 15 minutes.

### P1: Detach RTDB Battle Listeners (High, 30 minutes)

**Problem:** `subscribeToBattleRequests()` listeners never cleaned up. Listeners on entire `battle_requests` node fire for all players' battles.

**Solution:** 
1. Store unsubscribe function in `pvp.js`
2. Add cleanup on `beforeunload`
3. Add scoped RTDB query (filter by attackerId/targetId via `orderByChild`)

**Expected Impact:** Reduces RTDB bandwidth by filtering irrelevant battle events. Prevents listener accumulation on character switch.

**Effort:** 30 minutes.

### P1: Lazy-Load `world_cities.js` (High, 30 minutes)

**Problem:** 640KB JS file loaded eagerly on every page load.

**Solution:** Convert to dynamic `import()` that loads only when the global territory system is initialized (which is step 13 of 18 in the boot sequence).

**Expected Impact:** Save ~500ms on initial page load (parsing 640KB of JS takes measurable time on mobile).

**Effort:** 30 minutes.

### P1: Replace TailwindCSS CDN with Purged Build (High, 1 hour)

**Problem:** Full TailwindCSS (~300KB) loaded from CDN with only ~5% of classes used.

**Solution:** Even without a bundler, use Tailwind CLI to generate a purged CSS file: `npx tailwindcss -o www/css/tailwind.min.css --minify`. Serve locally.

**Expected Impact:** Reduce CSS from ~300KB to ~10-15KB (95% reduction). Faster first paint, less bandwidth.

**Effort:** 1 hour (setup Tailwind CLI config, adjust build scripts).

### P1: Reduce Turf.js Bundle (High, 1-2 hours)

**Problem:** Full Turf.js (~500KB raw) loaded for only `turf.point()`, `turf.distance()`, and `turf.booleanPointInPolygon()`.

**Solution:** Replace CDN Turf.js with a lightweight Haversine distance function (~20 lines) and a ray-casting point-in-polygon (~30 lines). These are the only Turf functions used in hot paths.

**Expected Impact:** Eliminate ~500KB from blocking resources. Faster distance calculations (avoid Turf overhead).

**Effort:** 1-2 hours.

### P2: Optimize `renderStaticMonsters()` (Medium, 2 hours)

**Problem:** Full clear + rebuild of all monster markers on every render call.

**Solution:** Maintain a `Map<id, marker>` and do incremental add/remove/update.

**Expected Impact:** Eliminate visible stutter when monsters are re-rendered after combat or world sync.

**Effort:** 2 hours.

### P2: Add Leaderboard Caching + Pagination (Medium, 1 hour)

**Problem:** `fetchLeaderboard()` reads ALL characters via unbounded collectionGroup.

**Solution:**
1. Add `limit(50)` to the query
2. Cache result in memory with 5-minute TTL
3. Only fetch when leaderboard tab is actually opened

**Expected Impact:** Reduce leaderboard reads from N (all characters) to 50 max, with 5-minute cache preventing repeated fetches.

**Effort:** 1 hour.

### P2: Remove `experimentalForceLongPolling` (Medium, 30 minutes)

**Problem:** Forces XHR long-polling, increasing latency and battery drain.

**Solution:** Test without it on Capacitor WebView. Use `experimentalAutoDetectLongPolling: true` as fallback.

**Expected Impact:** 100-500ms faster Firestore operations, better battery life on mobile.

**Effort:** 30 minutes (mostly testing).

### P3: Parallelize GPS + Firebase Init (Low, 1 hour)

**Problem:** GPS acquisition (up to 5s) blocks Firebase data fetches.

**Solution:** Start GPS and Firebase data fetches concurrently:
```javascript
const [gpsResult, worldData] = await Promise.allSettled([
  acquireGPS(),
  fetchSpawnedObjectsOnce(),
]);
```

**Expected Impact:** Up to 5s faster boot when GPS is slow.

**Effort:** 1 hour (refactor init sequence).

### P3: Debounce `processIncome()` (Low, 15 minutes)

**Problem:** Called every 1s in the game loop but only needs to run when the player is near income sources.

**Solution:** Check if player has any active income sources before processing. Add a 30s interval instead of 1s.

**Effort:** 15 minutes.

---

## Quick Wins (<1 hour each)

| # | Fix | File | Impact | Time |
|---|-----|------|--------|------|
| 1 | Remove `return true;` from `isAdmin()` | `firebase-service.js:266` | CRITICAL: 40-60% read reduction | 1 min |
| 2 | Remove `recalculateStats()` from regen loop | `app.js:958` | CRITICAL: 60 wasted calls/min eliminated | 5 min |
| 3 | Remove `triggerSave()` from `recalculateStats()` | `gameState.js:149` | CRITICAL: Prevents save-on-tick | 5 min |
| 4 | Store + call `subscribeToBattleRequests()` unsub | `pvp.js:21-25` | WARNING: RTDB listener leak fix | 15 min |
| 5 | Throttle `setupWorldSync()` to 30s | `app.js:537` | WARNING: 6 distance calcs/s -> 6/30s | 10 min |
| 6 | Add `limit(50)` to leaderboard query | `firebase-service.js:926` | WARNING: Bounds read cost | 5 min |
| 7 | Use `experimentalAutoDetectLongPolling` | `firebase-service.js:127` | WARNING: Faster Firestore ops | 5 min |

---

## RTDB Listener Inventory

| Listener | Node | Scope | Cleanup? | Risk |
|----------|------|-------|----------|------|
| `subscribeToPlayersRTDB()` | `live_players/` | ALL players | Returns unsub but caller stores it inconsistently | WARNING |
| `subscribeToBattleRequests()` | `battle_requests/` | ALL requests | **Never cleaned up** | CRITICAL |
| `subscribeToBattleChanges()` | `battle_requests/{id}` | Single battle | Returns unsub | OK |
| `subscribeToGroupRTDB()` | `groups/{id}` | Single group | Cleaned up in `cleanupGroups()` | OK |
| `subscribeToGroupInvites()` | `group_invites/{charId}` | Single char | Cleaned up in `cleanupGroups()` | OK |
| `subscribeToGroupDeclines()` | `group_invites/{charId}/declines` | Single char | Cleaned up in `cleanupGroups()` | OK |
| `subscribeToArenas()` | `arenas/` | ALL arenas | Returns unsub but storage varies | WARNING |
| `subscribeToWorldMetadata()` | `world_metadata/current_state` | Single doc | Returns unsub | OK |
| `subscribeToCombatRTDB()` | `combats/{id}` | Single combat | Returns unsub | OK |
| `checkFleePenalty()` | `players/{uid}/penalty_until` | Single value | `onlyOnce: true` | OK |

---

## Firestore `onSnapshot` Listener Inventory

| Listener | Collection | Scope | Cleanup? | Risk |
|----------|-----------|-------|----------|------|
| `subscribeToSpawnedObjects()` | `spawned_objects` | Per city | Cleaned up in `setupWorldSync()` | OK |
| `subscribeToWorldMetadata()` | `world_metadata/current_state` | Single doc | Returns unsub | OK |
| `subscribeToPlayers()` (Firestore) | `characters` (collectionGroup) | ALL characters | Returns unsub | WARNING: Admin only but bug exposes to all |
| `subscribeToPlayersLegacy()` | `users` | ALL users | Returns unsub | WARNING: Legacy, unclear if called |
| World snapshots listener | `world_snapshots` | ALL snapshots | Returns unsub | WARNING |

---

## setInterval/setTimeout Inventory (Hot Loops)

| Timer | Interval | File | Cleared? | Concern |
|-------|----------|------|----------|---------|
| Regen + Income + WorldSync | 1s | `app.js:534` | **Never** | CRITICAL: Runs forever, no clearInterval |
| Regen (alt path) | 1s | `app.js:942` | **Never** | CRITICAL: Same loop, second code path |
| Citadel proximity | 5s | `kingdom.js:21` | **Never** | Low impact |
| DB usage dashboard | 5s | `db-usage.js:16` | **Never** | Admin page only |
| Emergency monitor | varies | `emergency-monitor.js:235` | **Never** | Conditional |
| PvP request countdown | 1s | `pvp.js:258` | Cleared on status change | OK |
| Battle turn timer | 1s | `battle-logic.js:176` | Cleared on move | OK |
| Save debounce | 5s timeout | `app.js:549` | Reset on each trigger | OK |

**Note:** Two separate regen loops exist — one in the main init path (`app.js:534`) and one in the `startGameWithCharacter` path (`app.js:942`). If both paths execute, TWO intervals run simultaneously.

---

## Priority Roadmap

### Phase 1: Critical Fixes (Day 1)
1. Fix `isAdmin()` return true bug
2. Fix regen loop (remove recalculateStats, remove triggerSave from recalculateStats)
3. Detach battle request listeners
4. Check for duplicate regen intervals

### Phase 2: Cost Optimization (Week 1)
5. Add leaderboard caching + limit
6. Test removing `experimentalForceLongPolling`
7. Lazy-load `world_cities.js`
8. Throttle `setupWorldSync()` to 30s

### Phase 3: Loading Performance (Week 2)
9. Purge TailwindCSS (300KB -> 15KB)
10. Replace Turf.js with lightweight helpers (500KB -> 1KB)
11. Parallelize GPS + Firebase init

### Phase 4: Runtime Optimization (Week 3-4)
12. Incremental monster marker rendering
13. Dirty-flag save system
14. RTDB player listener scoping (geo-hash regions)

---

## Appendix: File Size Impact Summary

| Resource | Current Size | Optimized Size | Savings |
|----------|-------------|---------------|---------|
| TailwindCSS CDN | 300KB | ~15KB (purged) | 285KB (95%) |
| Turf.js CDN | 500KB | ~1KB (custom) | 499KB (99%) |
| world_cities.js | 640KB | 0KB at init (lazy) | 640KB deferred |
| **Total first-load savings** | | | **~1.4MB** |

Combined with the Firestore read reductions from fixing `isAdmin()` and the regen loop, these changes would significantly improve both cost and user experience.
