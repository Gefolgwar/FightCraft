---
trigger: always_on
---

# 🔥 Firebase Security Rules — FightCraft Reference

FightCraft uses **three** Firebase services with separate rules files. All are connected via `firebase.json`.

## How they are connected

```
firebase.json
├── "firebase/firestore.rules"       (Cloud Firestore)
├── "firebase/database.rules.json"   (Realtime Database)
└── "firebase/storage.rules"         (Cloud Storage)
```

---

## 1. Firestore (`firebase/firestore.rules`)

**Purpose:** Persistent storage — player profiles, characters, templates, castles, zones, battles.

### Key Function: `isAdmin()`
```javascript
function isAdmin() {
  return request.auth != null &&
    (request.auth.token.admin == true ||                          // Custom claim (safest)
     request.auth.uid == 'YshG61RxTIczGXOfFqiu2wqC63r2' ||       // Hardcoded UID (legacy fallback)
     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');    // Firestore role field (deprecating)
}
```

> ⚠️ **Warning:** The third option (Firestore role field) is a recursive read. It is planned to be removed after fully migrating to custom claims.

### Collections and Access Levels

| Collection | Read | Write | Important Restrictions |
|----------|------|-------|--------------------|
| `users/{userId}` | auth ✓ | owner (no role/uid fields) or admin | `role` and `uid` — protected fields |
| `users/.../characters/{charId}` | auth ✓ | owner or admin | Nested subcollection |
| `users/.../invites/{inviteId}` | owner | create: auth ✓; update/delete: owner | Anyone can create an invite |
| `combats/{combatId}` | auth ✓ | battle participants (attackerId/targetId) | Admin for delete |
| `templates/{templateId}` | auth ✓ | admin only | Game object templates |
| `spawned_objects/{objectId}` | auth ✓ | update only `defeatedAt` (number) | Monster cooldown |
| `castles`, `world_*`, `city_zones` | auth ✓ | admin only | Game world |
| `players/{playerId}` | auth ✓ | owner or admin | Legacy collection |
| `{document=**}` | ❌ | ❌ | Deny all fallback |

### Field Protection Pattern
```javascript
!request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'uid'])
```
Players CANNOT change their `role` or `uid` field — only admins can.

### Monster Cooldown Pattern
```javascript
request.resource.data.diff(resource.data).affectedKeys().hasOnly(['defeatedAt'])
&& request.resource.data.defeatedAt is number
```
Players can **only** change `defeatedAt` in `spawned_objects` — and only to a number.

---

## 2. Realtime Database (`firebase/database.rules.json`)

**Purpose:** Ephemeral/live storage — player positions on the map, real-time PvP battles, groups.

### Key Nodes

| Node | Read | Write | Validation |
|-------|------|-------|-----------| 
| `live_players/$charId` | auth ✓ | creator (userId == auth.uid) | Required: id, userId, name, position (lat/lng numbers) |
| `battle_requests/$battleId` | auth ✓ | attacker to create; attacker or target to update | Required: battleId, attackerId, targetId, status |
| `battle_requests/.../moves/$uid` | auth ✓ | $uid === auth.uid | Required: timestamp |
| `battles/$battleId` | auth ✓ | auth ✓ (⚠️ broad) | round validation: attack, defense, ready |
| `combats/$combatId` | auth ✓ | auth ✓ (if initiatorId exists) | Required: type, status |
| `players/$uid` | auth ✓ | $uid === auth.uid | — |
| `groups/$groupId` | auth ✓ | auth ✓ (if leaderId exists) | Required: id, leaderId, status |
| `group_invites/$targetCharId` | auth ✓ | auth ✓ (⚠️ broad) | Required: groupId, inviterName, inviterCharId |
| `arenas/$arenaId` | auth ✓ | auth ✓ (⚠️ broad) | Required: id, center (lat/lng), type |

> ⚠️ **Known Vulnerabilities:** `battles`, `group_invites`, and `arenas` have overly broad write rules (`auth != null`). Any authenticated user can modify any battle/arena. This is planned to be fixed.

### GPS Validation
```json
"position": {
  ".validate": "newData.hasChildren(['lat', 'lng']) && newData.child('lat').isNumber() && newData.child('lng').isNumber()"
}
```
Coordinates are checked for presence and numeric type, but **NOT** for range (lat: -90..90, lng: -180..180).

---

## 3. Storage (`firebase/storage.rules`)

**Purpose:** Static bundles for SyncEngine (minimizing Firestore reads).

| Path | Read | Write |
|------|------|-------|
| `/bundles/{fileName}` | auth ✓ | admin only (custom claim `admin == true`) |
| `/{allPaths=**}` | ❌ | ❌ |

> Storage rules **only** use the custom claim for admin — without the hardcoded UID fallback.

---

## Rules for Working with Firebase Rules

1. **Never** write `allow read, write: if true` — not even temporarily.
2. **Always** check `isAdmin()` after changes — this is a critical function.
3. When adding a new collection — add explicit rules **and** ensure that the deny-all fallback remains last.
4. RTDB `.validate` rules act as a data schema. Always add validation for new nodes.
5. Deploy rules: `npx firebase deploy --only firestore:rules,database,storage`.