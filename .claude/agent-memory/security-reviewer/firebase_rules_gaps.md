---
name: Firebase Rules Gaps
description: Critical vulnerabilities in Firestore, Storage, and RTDB rules allowing privilege escalation and state takeover.
type: project
---
- **Firestore:** Users can update their own `role` to `'admin'`, gaining full DB access.
- **Storage:** `/bundles` is writable by any authenticated user.
- **RTDB:** `live_players` and `battles` allow global writes (`.write: "auth != null"`).
**Why:** Rules were likely left open during early prototyping.
**How to apply:** Ensure rule fixes are prioritized. Do not assume `isAdmin()` is secure until the profile update vulnerability is patched.