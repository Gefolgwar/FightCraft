---
name: security-audit
description: "Security audit of Firebase Security Rules (Firestore, RTDB, Storage). Activated on rules file changes, before deploy, or on 'security audit' request. Checks for permissive writes, ownership, hardcoded UIDs, GPS validation."
---

# 🔒 Security Audit — Firebase Rules

## Dynamic Context

Before analyzing, you MUST read the current state of the rules:

```powershell
# Current Firestore rules
Get-Content "firebase/firestore.rules"

# Current RTDB rules
Get-Content "firebase/database.rules.json"

# Current Storage rules
Get-Content "firebase/storage.rules"

# Quick check for permissive rules
Select-String -Pattern "if true|if false" firebase/firestore.rules,firebase/database.rules.json,firebase/storage.rules

# Check isAdmin()
Select-String -Pattern "isAdmin" firebase/firestore.rules
```

## Project Configuration

| Parameter | Value |
|----------|---------|
| Project ID | `fight-craft-3c3f0` |
| Firestore Rules | `firebase/firestore.rules` (Rules Language v2) |
| RTDB Rules | `firebase/database.rules.json` (JSON Rules) |
| Storage Rules | `firebase/storage.rules` (Rules Language v2) |

## MCP Tools

| Tool | Action |
|------------|-----|
| `firebase_validate_security_rules(type: "firestore")` | Syntax validation for Firestore |
| `firebase_validate_security_rules(type: "rtdb")` | Syntax validation for RTDB |
| `firebase_validate_security_rules(type: "storage")` | Syntax validation for Storage |
| `firebase_get_security_rules(type: "firestore")` | Get production rules for comparison |

## Checklist

### 🔴 CRITICAL (Blocks deploy)

1. **Permissive Writes** — `.write: "auth != null"` without ownership check
   ```json
   // 🚩 BAD: anyone can overwrite a battle
   "battles/$battleId": { ".write": "auth != null" }
   // ✅ GOOD: only participants
   ".write": "auth != null && (data.child('player1Id').val() === auth.uid || data.child('player2Id').val() === auth.uid)"
   ```

2. **Open Rules** — `allow read, write: if true` in any file
   > ⚠️ If found → **STOP DEPLOY IMMEDIATELY**

3. **Missing `.validate`** — a node allows writes without validating data structure

4. **Hardcoded UIDs** — `request.auth.uid == 'XXXX'` instead of Custom Claims

### 🟡 WARNINGS

5. **Overly Broad Read** — `allow read: if request.auth != null` on sensitive collections
6. **Missing Rate Limiting** — no limits on write frequency
7. **No Cascading Deletes** — deleting a parent doesn't clean up subcollections
8. **GPS Range Validation** — coordinates are checked for type, but not for range
   ```json
   // Should be: lat ∈ [-90, 90], lng ∈ [-180, 180]
   "newData.child('lat').val() >= -90 && newData.child('lat').val() <= 90"
   ```

### 🟢 BEST PRACTICES

9. **Field-Level Protection** — `affectedKeys()` to protect `role`, `uid`
10. **Admin Custom Claims** — `request.auth.token.admin == true`
11. **Server Timestamps** — `request.time` for `createdAt`/`updatedAt`

## Algorithm

```
1. READ: firebase/firestore.rules, firebase/database.rules.json, firebase/storage.rules
2. MCP: firebase_validate_security_rules × 3 (syntax)
3. PATTERN MATCH: checks 1-11 (see above)
4. MCP: firebase_get_security_rules → compare local vs production (drift)
5. REPORT: create Security Audit Report with 🔴/🟡/🟢 sections
```

## Known Vulnerabilities (Current State)

| Node | Issue | Severity |
|-------|----------|----------|
| `battles/$battleId` | `.write: "auth != null"` without ownership | 🔴 |
| `arenas/$arenaId` | `.write: "auth != null"` | 🟡 |
| `group_invites` | `.write: "auth != null"` | 🟡 |
| `firebase/firestore.rules` | Hardcoded UID `YshG61RxTIczGXOfFqiu2wqC63r2` | 🟡 |
| RTDB GPS | Type is validated, range is not | 🟡 |

> **This skill ONLY READS and ANALYZES. It never modifies rules automatically.**