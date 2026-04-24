# Overpass API Reliability Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the world generation script from crashing due to unreliable, offline third-party Overpass mirrors.

**Architecture:** Remove unstable endpoints from `OVERPASS_ENDPOINTS`, increase retry limits to 4 attempts, and bypass the 1500ms sleep during hard network failures for instant failover to the next mirror.

**Tech Stack:** Vanilla JS, Overpass API.

---

### Task 1: Clean Mirror List & Increase Retries

**Files:**
- Modify: `www/map/overpass-service.js`

- [ ] **Step 1: Write the failing test (Manual Console Verification)**

*Since there is no automated test framework, we verify via code inspection and browser console.*
Run: Open `http://localhost:5000/maintenance/admin.html`, open DevTools Console, and run:
`const { OverpassService } = await import('../map/overpass-service.js'); console.log(OverpassService.getEndpoint());`
Expected: You may see `https://lz4.overpass-api.de/api/interpreter`, but subsequent calls might return the unreliable `.tw` or `.systems` endpoints.

- [ ] **Step 2: Write minimal implementation**

Update `OVERPASS_ENDPOINTS` and the retry limits inside `fetchJSON`.

```javascript
// Replace this existing code in www/map/overpass-service.js (around line 3):
const OVERPASS_ENDPOINTS = [
    "https://lz4.overpass-api.de/api/interpreter", // Usually more robust
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
];

// With:
const OVERPASS_ENDPOINTS = [
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter"
];


// Replace this existing code (around line 28):
    static async fetchJSON(query, attempt = 0) {
        if (attempt > 2) throw new Error("Overpass API failed after multiple retries.");

// With:
    static async fetchJSON(query, attempt = 0) {
        if (attempt > 3) throw new Error("Overpass API failed after multiple retries.");


// Replace this existing code in the catch block (around line 61):
            if (attempt < 2) {

// With:
            if (attempt < 3) {
```

- [ ] **Step 3: Run test to verify it passes**

Run in browser console: `const { OverpassService } = await import('../map/overpass-service.js'); console.log(OverpassService.getEndpoint());`
Run it 4 times.
Expected: It should strictly alternate between `lz4.overpass-api.de` and `overpass-api.de`.

- [ ] **Step 4: Commit**

```bash
git add www/map/overpass-service.js
git commit -m "refactor: clean overpass endpoints and increase retry limit to 4"
```

---

### Task 2: Implement Smart Failover

**Files:**
- Modify: `www/map/overpass-service.js`

- [ ] **Step 1: Write the failing test (Manual Inspection)**

Review the `catch` block in `fetchJSON`. 
Expected: It always sleeps for 1500ms even if the endpoint is completely unreachable (e.g., DNS failure, CORS error).

- [ ] **Step 2: Write minimal implementation**

Modify the `catch` block inside `fetchJSON` to skip the sleep when encountering a hard network error (like `Failed to fetch`).

```javascript
// Replace this existing code in www/map/overpass-service.js (around line 59):
        } catch (e) {
            console.warn(`❌ Overpass Error on ${endpoint}: ${e.message}`);
            if (attempt < 3) {
                await this.sleep(1500);
                return this.fetchJSON(query, attempt + 1);
            }
            throw e;
        }

// With:
        } catch (e) {
            console.warn(`❌ Overpass Error on ${endpoint}: ${e.message}`);
            if (attempt < 3) {
                // Smart failover: Skip the sleep penalty if it's a hard network error (e.g. server down)
                const isNetworkError = e.message.includes("Failed to fetch") || e.name === "TypeError";
                if (!isNetworkError) {
                    await this.sleep(1500);
                }
                return this.fetchJSON(query, attempt + 1);
            }
            throw e;
        }
```

- [ ] **Step 3: Run test to verify it passes**

Run: Go to the admin panel and run "Generate Global World".
Expected: Since the endpoints are now highly reliable, errors should be extremely rare. If one does occur (simulate by disconnecting internet briefly), the console should show the error and instantly retry the next endpoint without a 1.5s delay.

- [ ] **Step 4: Commit**

```bash
git add www/map/overpass-service.js
git commit -m "feat: bypass sleep penalty for overpass network failures"
```
