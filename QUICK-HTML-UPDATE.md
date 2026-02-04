# ⚡ QUICK: Update MP Debug UI

## 🎯 Goal: Add View & Delete Buttons

### Step 1: Find Location in index.html

Search for one of these:
- `id="mp-debug"` (if already added)
- `id="debug-options"` then find its closing `</div>`

### Step 2: Replace or Insert

**File to Copy From:** `mp-debug-ui-enhanced.html`

**Key Changes:**
```html
<!-- OLD (3 buttons vertically) -->
<div class="space-y-1">
    <button onclick="createTestPlayer()" ...>➕ Create</button>
    <button onclick="refreshPlayersList()" ...>🔄 Refresh</button>
    <button onclick="showAllPlayersOnMap()" ...>🗺️ Show All</button>
</div>

<!-- NEW (View & Delete in 2 cols, then 3 buttons) -->
<div class="grid grid-cols-2 gap-1">
    <button onclick="switchToPlayer()" ...>👁️ View</button>
    <button onclick="deleteSelectedPlayer()" ...>🗑️ Delete</button>
</div>
<div class="space-y-1">
    <button onclick="createTestPlayer()" ...>➕ Create</button>
    <button onclick="refreshPlayersList()" ...>🔄 Refresh</button>
    <button onclick="showAllPlayersOnMap()" ...>🗺️ Show All</button>
</div>
```

### Step 3: Save & Reload

```
Ctrl + S  (save)
Ctrl + F5 (hard reload browser)
```

### Step 4: Test (30 seconds)

```
1. Debug Mode ON
2. Create test player
3. Select it from dropdown
4. Click "👁️ View" → map centers ✓
5. Click "🗑️ Delete" → confirm → removed ✓
6. Create 2-3 more
7. Click "🗺️ Show All on Map" → all visible ✓
```

---

**Time:** 3 minutes  
**Difficulty:** Easy copy-paste

✅ Done? Test the 4 steps above!
