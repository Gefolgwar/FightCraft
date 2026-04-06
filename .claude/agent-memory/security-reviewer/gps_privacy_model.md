---
name: GPS Privacy Model
description: GPS coordinates are shared globally in RTDB without rounding.
type: project
---
Players currently broadcast their exact GPS coordinates (6+ decimal places) to RTDB (`live_players`), which is globally readable by any authenticated user.
**Why:** Required for the real-time map MVP, but poses severe stalking/GDPR risks.
**How to apply:** When modifying map or sync logic, suggest rounding coordinates or implementing distance-based geo-queries to minimize PII exposure.