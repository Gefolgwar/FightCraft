# Security Findings and Proposed PRD Updates

After reviewing the current Firebase security rules (`firestore.rules`, `database.rules.json`, `storage.rules`) and comparing them against the current `docs/PRD.md`, several discrepancies, undocumented mechanisms, and new vulnerabilities were identified.

## 1. Undocumented Security Mechanisms
The following security mechanisms are currently implemented in the rules but missing from the PRD's "Security Model" section:

* **Strict Field-Level Protection for PvE (`firestore.rules`):** Authenticated users are allowed to update `spawned_objects` to trigger monster cooldowns, but this is strictly limited to modifying **only** the `defeatedAt` field, and it must be a number. This is a critical pattern for a serverless game that prevents players from tampering with monster stats or other data.
* **Inbox Pattern for Invites (`firestore.rules`):** The `users/{userId}/invites` subcollection implements an inbox pattern where any authenticated user can create an invite (send to target), but only the recipient (`userId`) can read, update, or delete it.
* **Strict Admin Claims for Storage (`storage.rules`):** Unlike Firestore rules which use a 3-tier fallback for `isAdmin()` (custom claims, hardcoded UID, Firestore role), the Storage rules strictly require the `admin == true` custom claim for writes. The fallbacks are not implemented there.
* **Collection Group Queries Protection (`firestore.rules`):** The rules explicitly restrict `/{path=**}/characters/{characterId}` reads to admins only, preventing malicious users from scraping all player character data across the database.

## 2. Unlisted Vulnerabilities & Gaps
The PRD lists `battles`, `group_invites`, and `arenas` as having overly broad write rules (`auth != null`) in RTDB. However, the review identified additional gaps:

* **`combats` and `groups` (RTDB):** These nodes also suffer from permissive write rules. `combats` allows writes if `!data.exists() || data.child('initiatorId').exists()`, and `groups` allows writes if `!data.exists() || data.child('leaderId').exists()`. Neither enforces strict ownership matching `auth.uid`, meaning any authenticated user could potentially overwrite or tamper with active groups or combats.
* **Insufficient GPS Validation (RTDB):** While the `live_players` node checks that `lat` and `lng` are numbers, it does not validate that they fall within valid geographical ranges (-90 to 90 for latitude, -180 to 180 for longitude). This, combined with a lack of server-side speed/teleportation checks, leaves the game highly vulnerable to GPS spoofing.

## Proposed PRD Updates

**Update the "Security Model" section in `docs/PRD.md` to the following:**

```markdown
### Security Model

- **Admin Verification:** Admin privileges in Firestore are determined by a custom claim (`admin == true`), a hardcoded UID fallback, or a Firestore `role` field (being deprecated). **Note:** Storage rules are stricter and *only* accept the custom claim.
- **Protected User Fields:** The `role` and `uid` fields on user documents cannot be modified by the user.
- **Field-Level Cooldowns:** To allow client-side PvE without Cloud Functions, players can update `spawned_objects`, but rules restrict them to modifying *only* the `defeatedAt` field (must be a number).
- **Inbox Pattern:** System invites use an inbox pattern (`users/{userId}/invites`) where anyone can create a document, but only the owner can read/modify it.
- **Known Security Gaps:** 
  - `battles`, `group_invites`, `arenas`, `combats`, and `groups` in RTDB have overly broad write rules (e.g., `auth != null` without strict ownership validation). Any authenticated user can potentially tamper with these nodes.
  - GPS coordinates in RTDB only validate data type (number), lacking range bounds (-90..90, -180..180) and spoofing/teleportation detection.
  - The `isAdmin()` function still includes a recursive Firestore read fallback for role-based checks, planned for removal after full custom claims migration.
```

## Next Steps
1. Incorporate these updates into `docs/PRD.md` to ensure the document accurately reflects the current security posture and technical debt.
2. Prioritize fixing the permissive RTDB write rules for `combats` and `groups` to prevent session hijacking or griefing.