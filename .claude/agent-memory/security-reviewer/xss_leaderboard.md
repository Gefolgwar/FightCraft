---
name: xss_leaderboard
description: Stored XSS vulnerability in the PvP leaderboard UI due to unescaped character names.
type: project
---

The PvP leaderboard (`pvp.js` around line 140) renders player names directly into the DOM using string interpolation (`${p.name}`) via `innerHTML`. Since character names are client-authoritative and completely unvalidated in Firestore/RTDB, an attacker can set their name to an XSS payload (e.g., `<script>` or `<img src=x onerror=...`) which will execute on all other clients viewing the leaderboard.

**Why:** There is no client-side DOM sanitization (e.g., DOMPurify or mapping textContent) before inserting raw data from Firebase into the UI.
**How to apply:** Always recommend encoding or sanitizing user-provided text (names, chat) before inserting it via `innerHTML`, or prefer using `.textContent` for dynamic elements.