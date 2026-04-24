# Overpass API Reliability Fix Design Spec

## Overview
Update the `OverpassService` (`www/map/overpass-service.js`) to prevent the world generation script from crashing due to unreliable, offline third-party Overpass mirrors.

## Technical Architecture

### 1. Clean the Mirror List
Remove historically unreliable servers from `OVERPASS_ENDPOINTS` to ensure requests only hit stable, official infrastructure.
**New List:**
```javascript
const OVERPASS_ENDPOINTS = [
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter"
];
```

### 2. Increase Retry Limits
Currently, the `fetchJSON` method gives up if `attempt > 2`. We will increase this to `attempt > 3` (allowing 4 total attempts). This ensures the script has enough runway to bounce between the two reliable servers multiple times in case of rate limiting (HTTP 429).

### 3. Smart Failover (Zero-Wait for Dead Servers)
Modify the `catch (e)` block in `fetchJSON`. 
- **Current state**: If a server is completely dead (throwing a hard network error like `Failed to fetch`), the script pointlessly waits 1.5 seconds before trying the next mirror.
- **New state**: If the error represents a hard network failure (i.e., `e.message.includes("Failed to fetch")` or `e.name === "TypeError"`), immediately trigger the retry loop without the `1500ms` sleep to instantly hit the next mirror.
- **Rate Limits**: Actual HTTP 429 or 502 errors handled in the `try` block will continue to respect the 2000ms backoff sleep before retrying.

### Dependencies
- No new libraries needed.
- Operates entirely within `www/map/overpass-service.js`.