# 🔒 Rule: Firebase Security Rules Linting

## When to use

ALWAYS run a security lint before deploying Firebase rules:

1. **Automatically** — before every `firebase deploy` or `firebase deploy --only firestore,database,storage`
2. **On rules modification** — any changes in `firebase/firestore.rules`, `firebase/database.rules.json`, `firebase/storage.rules`
3. **On request** — when the user says "security audit", "check rules", or "security review"

## Procedure (4 steps)

### Step 1: Syntax Validation (MCP)
```
firebase_validate_security_rules(type: "firestore", source_file: "firebase/firestore.rules")
firebase_validate_security_rules(type: "storage", source_file: "firebase/storage.rules")
firebase_validate_security_rules(type: "rtdb", source_file: "firebase/database.rules.json")
```
❌ If there are syntax errors — STOP, do not deploy.

### Step 2: Load Skill
Read `.agents/skills/security-audit/SKILL.md` for the full list of checks.

### Step 3: Pattern Matching
Check against the 9 patterns from SKILL.md:
- 🔴 Permissive Writes, Missing Validation, Hardcoded UIDs
- 🟡 Broad Read Access, Missing Rate Limiting, No Cascading Deletes
- 🟢 Field-Level Protection, Admin Claims, Timestamp Validation

### Step 4: Drift Detection
```
firebase_get_security_rules(type: "firestore")
```
Compare local rules with production rules. If there is a difference, warn the user.

## Known Issues (Current State)

| File | Issue | Severity |
|------|----------|--------|
| `firebase/database.rules.json` | `battles/$battleId` — `.write: "auth != null"` without ownership | 🔴 |
| `firebase/database.rules.json` | `combats/$combatId` — permissive write check | 🔴 |
| `firebase/database.rules.json` | `arenas/$arenaId` — `.write: "auth != null"` | 🟡 |
| `firebase/database.rules.json` | `group_invites` — `.write: "auth != null"` | 🟡 |
| `firebase/firestore.rules` | Hardcoded UID | 🟡 |
| `firebase/firestore.rules` | `combats` — broad read (`auth != null`) | 🟡 |

## Deployment Blocking

- 🔴 CRITICAL — report, but DO NOT block automatically. Warn the user.
- 🟡 WARNING — report only.
- 🟢 GOOD — provide positive feedback.

> **Never** modify rules automatically. Always wait for the user's confirmation.
