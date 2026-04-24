# Map Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to toggle map templates (World Snapshots) ON and OFF, track spawned objects to their source templates, and mass delete templates safely.

**Architecture:** Modify `firebase-service.js` to add `sourceTemplateId` to live objects and an `isActive` flag on templates. Introduce `deactivateWorldSnapshot` to clean up objects. Upgrade `templates_map.html` to use a toggle switch for activation and integrate `template-bulk-actions.js` for mass deletion.

**Tech Stack:** Vanilla JS, Firebase Firestore (Web SDK v10), TailwindCSS.

---

### Task 1: Add `deactivateWorldSnapshot` and update Data Model

**Files:**
- Modify: `www/firebase/firebase-service.js`

- [ ] **Step 1: Write the failing test (Manual Verification)**
Open browser console and run: `import('./firebase/firebase-service.js').then(m => console.log(m.deactivateWorldSnapshot))`
Expected: `undefined`

- [ ] **Step 2: Add `deactivateWorldSnapshot`**
Add the new function to `www/firebase/firebase-service.js` (you can put it below `applyWorldSnapshot`).
```javascript
export async function deactivateWorldSnapshot(snapshotId) {
    if (!isAdmin()) return false;
    try {
        const { collection, query, where, getDocs, writeBatch, doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        // 1. Find all live objects that belong to this template
        const q = query(collection(db, 'spawned_objects'), where('sourceTemplateId', '==', snapshotId));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            console.log(`🧹 Removing ${querySnapshot.size} objects for template ${snapshotId}...`);
            let batch = writeBatch(db);
            let count = 0;
            
            for (const document of querySnapshot.docs) {
                batch.delete(document.ref);
                count++;
                if (count % 500 === 0) {
                    await batch.commit();
                    batch = writeBatch(db);
                }
            }
            if (count % 500 !== 0) await batch.commit();
        }
        
        // 2. Mark snapshot as inactive
        await updateDoc(doc(db, 'world_snapshots', snapshotId), { isActive: false });
        console.log(`✅ Template ${snapshotId} deactivated.`);
        return true;
    } catch (e) {
        console.error('Error deactivating snapshot:', e);
        return false;
    }
}
```

- [ ] **Step 3: Modify `saveWorldSnapshot`**
Inside `saveWorldSnapshot` in `www/firebase/firebase-service.js`, ensure new snapshots start as `isActive: false`.
Find:
```javascript
        const snapshotData = {
```
(Note: it's passed as argument, so modify the cleanup data before saving).
Find this block:
```javascript
        // Remove the id from data if it's there to avoid overlap issues
        const { id: _, ...cleanedData } = snapshotData;
```
Change to:
```javascript
        // Remove the id from data if it's there to avoid overlap issues
        const { id: _, ...cleanedData } = snapshotData;
        cleanedData.isActive = false; // Initialize as inactive
```

- [ ] **Step 4: Modify `applyWorldSnapshot`**
Update `applyWorldSnapshot` to inject `sourceTemplateId`, remove the `merge` clear logic, and set `isActive: true`.
Replace the ENTIRE `applyWorldSnapshot` function with:
```javascript
export async function applyWorldSnapshot(snapshotId) {
    if (!isAdmin()) return false;

    // 1. Get Snapshot
    const snap = await getSnapshotById(snapshotId);
    if (!snap) return false;

    const { cityId, type, objects } = snap;
    if (!cityId || !type || !objects) return false;

    console.log(`➕ Activating template: adding ${objects.length} objects.`);

    // 2. Inject sourceTemplateId into objects
    const taggedObjects = objects.map(obj => ({
        ...obj,
        sourceTemplateId: snapshotId
    }));

    // 3. Save Objects to Live
    const success = await saveGeneratedObjects(taggedObjects);
    
    if (success) {
        // 4. Mark snapshot as active
        try {
            const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            await updateDoc(doc(db, 'world_snapshots', snapshotId), { isActive: true });
        } catch (e) {
            console.error("Failed to update isActive flag on snapshot", e);
        }
    }
    
    return success;
}
```

- [ ] **Step 5: Safely Delete Active Snapshots**
Update `deleteSnapshot` in `www/firebase/firebase-service.js`. Check if active before deleting.
Replace the `try` block inside `deleteSnapshot` with:
```javascript
    try {
        const { doc, getDoc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const snapRef = doc(db, 'world_snapshots', snapshotId);
        
        // Safety check: Deactivate before delete
        const snapDoc = await getDoc(snapRef);
        if (snapDoc.exists() && snapDoc.data().isActive === true) {
            console.log(`⚠️ Snapshot ${snapshotId} is active. Deactivating first...`);
            await deactivateWorldSnapshot(snapshotId);
        }
        
        await deleteDoc(snapRef);
        trackUsage('delete', `[admin] [видалення знімку світу: ${snapshotId}]`, 1, `world_snapshots/${snapshotId}`);
        console.log(`🗑️ Snapshot deleted: ${snapshotId}`);
        localStorage.removeItem("admin_snapshots_list");
        return true;
    } catch (e) {
```

- [ ] **Step 6: Commit**
```bash
git add www/firebase/firebase-service.js
git commit -m "feat: implement active/inactive states and source tracking for world snapshots"
```

---

### Task 2: Integrate Activation Toggle in UI

**Files:**
- Modify: `www/map/templates_map.html`

- [ ] **Step 1: Update UI HTML Template**
In `www/map/templates_map.html`, find the sidebar details HTML construction (`const detailsHtml = ...`) around line 185. Replace the "Apply to Live Map" button with a Toggle button.
Find:
```html
                    <div class="flex gap-2">
                        <button id="btn-delete-snap" class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs text-white font-bold transition flex items-center gap-1 opacity-50 cursor-not-allowed" disabled onclick="window.deleteCurrentSnapshot()">
                            <i class="fas fa-trash-alt"></i> Delete
                        </button>
                        <button id="btn-apply" class="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-bold transition opacity-50 cursor-not-allowed" disabled onclick="window.applyCurrentSnapshot()">
                            <i class="fas fa-layer-group mr-1"></i> Apply to Live Map
                        </button>
                    </div>
```
Replace with:
```html
                    <div class="flex gap-2 items-center justify-between mt-2">
                        <button id="btn-delete-snap" class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs text-white font-bold transition flex items-center gap-1 opacity-50 cursor-not-allowed" disabled onclick="window.deleteCurrentSnapshot()">
                            <i class="fas fa-trash-alt"></i> Delete
                        </button>
                        
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold ${snap.isActive ? 'text-green-400' : 'text-gray-500'}" id="toggle-status-text">
                                ${snap.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                            <button id="btn-toggle-active" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${snap.isActive ? 'bg-green-500' : 'bg-gray-600'}" onclick="window.toggleCurrentSnapshot()">
                                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${snap.isActive ? 'translate-x-6' : 'translate-x-1'}"></span>
                            </button>
                        </div>
                    </div>
```

- [ ] **Step 2: Expose `deactivateWorldSnapshot` and add `toggleCurrentSnapshot`**
At the top of the `<script type="module">` block, add `deactivateWorldSnapshot` to the imports from `firebase-service.js`.
```javascript
import { initFirebase, isAdmin, getCurrentUser, getWorldSnapshots, getSnapshotById, applyWorldSnapshot, deactivateWorldSnapshot, deleteSnapshot } from '../firebase/firebase-service.js';
```

Then, replace the old `window.applyCurrentSnapshot` logic with the new `window.toggleCurrentSnapshot` logic.
Find `window.applyCurrentSnapshot = async () => { ... }` and replace it entirely with:
```javascript
        window.toggleCurrentSnapshot = async () => {
            if (!currentSnapshot) return;

            const btn = document.getElementById('btn-toggle-active');
            const statusText = document.getElementById('toggle-status-text');
            
            // Loading state
            btn.classList.add('opacity-50', 'cursor-wait');
            btn.disabled = true;

            try {
                if (currentSnapshot.isActive) {
                    // DEACTIVATE
                    if (!confirm(`Turn OFF template "${currentSnapshot.name || currentSnapshot.id}"?\nThis will remove its objects from the live map.`)) {
                        btn.classList.remove('opacity-50', 'cursor-wait');
                        btn.disabled = false;
                        return;
                    }
                    
                    statusText.textContent = "DEACTIVATING...";
                    const success = await deactivateWorldSnapshot(currentSnapshot.id);
                    if (success) {
                        currentSnapshot.isActive = false;
                        logConsole(`🔴 Deactivated template: ${currentSnapshot.name}`);
                    }
                } else {
                    // ACTIVATE
                    if (!confirm(`Turn ON template "${currentSnapshot.name || currentSnapshot.id}"?\nThis will add its objects to the live map.`)) {
                        btn.classList.remove('opacity-50', 'cursor-wait');
                        btn.disabled = false;
                        return;
                    }
                    
                    statusText.textContent = "ACTIVATING...";
                    const success = await applyWorldSnapshot(currentSnapshot.id);
                    if (success) {
                        currentSnapshot.isActive = true;
                        logConsole(`🟢 Activated template: ${currentSnapshot.name}`);
                        
                        // Automated Territory Generation (If Citadels present)
                        const objects = currentSnapshot.objects || [];
                        const citadels = objects.filter(o =>
                            o.icon === '🏯' ||
                            (o.name && o.name.includes('Citadel')) ||
                            o.templateId?.includes('citadel')
                        );

                        if (citadels.length >= 2) {
                            logConsole(`<i class="fas fa-draw-polygon text-orange-400 mr-1"></i> Syncing <b>${citadels.length}</b> citadels to territories...`);
                            await regenerateCityTerritory(currentSnapshot.cityId, citadels, null);
                        }
                    }
                }
            } catch (e) {
                console.error("Toggle error:", e);
                logConsole(`❌ Error toggling template: ${e.message}`);
            }

            // Restore UI state
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-wait');
            
            // Re-render selection to refresh styles
            selectSnapshot(currentSnapshot);
            loadSnapshots(); // refresh the sidebar list to update badges
        };
```

- [ ] **Step 3: Show active badge in the sidebar**
In `loadSnapshots()`, find where the `el.innerHTML` is built for each snapshot in the list.
Find:
```html
                    <div class="font-bold text-sm text-gray-200 truncate pr-2">${snap.name || snap.id.substr(0, 15)}</div>
```
Replace with:
```html
                    <div class="flex items-center gap-2 pr-2">
                        <div class="font-bold text-sm text-gray-200 truncate">${snap.name || snap.id.substr(0, 15)}</div>
                        ${snap.isActive ? '<span class="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[9px] font-bold rounded uppercase">Active</span>' : ''}
                    </div>
```

- [ ] **Step 4: Commit**
```bash
git add www/map/templates_map.html
git commit -m "feat: add template active/inactive toggle switch in UI"
```

---

### Task 3: Mass Delete UI using `BulkActions`

**Files:**
- Modify: `www/map/templates_map.html`

- [ ] **Step 1: Import and instantiate `BulkActions`**
In `www/map/templates_map.html`, at the top of `<script type="module">`:
Add import:
```javascript
        import { BulkActions } from '../maintenance/template-bulk-actions.js';
```
Right below the variable declarations (`let map; let currentSnapshot = null; ...`), instantiate the bulk actions:
```javascript
        let bulkActions = null;
```
Inside `document.addEventListener('DOMContentLoaded', async () => {`, initialize it right after `initFirebase();`:
```javascript
            bulkActions = new BulkActions(deleteSnapshot, loadSnapshots);
```

- [ ] **Step 2: Render Checkboxes in the Sidebar List**
Inside `loadSnapshots()`, near the top where the list is cleared (`list.innerHTML = '';`):
Add:
```javascript
            list.innerHTML = '';
            
            const visibleIds = snaps.map(s => s.id);
            if (bulkActions) bulkActions.injectSelectAllHeader(list, visibleIds);
```

Next, for each snapshot element (`el.innerHTML = ...`), we need to insert the checkbox. Wait, `template-bulk-actions.js` says: `bulk.createCheckbox(t.id)` which returns an HTMLElement. Since the list is currently built via `innerHTML`, we must append the checkbox.
Find inside `loadSnapshots`:
```javascript
                el.innerHTML = `
                <div class="flex justify-between items-start mb-1">
```
Change to:
```javascript
                el.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <div class="flex items-center gap-2 w-full overflow-hidden">
                        <div class="bulk-checkbox-container"></div>
                        <div class="flex flex-col overflow-hidden w-full">
                            <div class="flex items-center gap-2 pr-2">
                                <div class="font-bold text-sm text-gray-200 truncate">${snap.name || snap.id.substr(0, 15)}</div>
                                ${snap.isActive ? '<span class="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[9px] font-bold rounded uppercase">Active</span>' : ''}
                            </div>
                            <div class="text-[10px] text-gray-500">${dateStr}</div>
                        </div>
                    </div>
                </div>
                <div class="text-[10px] text-gray-400 flex items-center justify-between mt-2">
                    <div>
                        <i class="fas fa-globe text-blue-500/50 mr-1"></i> ${snap.cityId}
                    </div>
                    <div>
                        ${iconsHtml}
                    </div>
                </div>
                `;

                // Inject bulk checkbox
                if (bulkActions) {
                    const cbContainer = el.querySelector('.bulk-checkbox-container');
                    cbContainer.appendChild(bulkActions.createCheckbox(snap.id));
                }

                el.addEventListener('click', (e) => {
                    // Ignore click if clicking the checkbox
                    if (e.target.tagName.toLowerCase() === 'input') return;
                    
                    document.querySelectorAll('[id^="snap-"]').forEach(d => d.classList.remove('border-blue-500', 'bg-gray-800'));
                    el.classList.add('border-blue-500', 'bg-gray-800');
                    selectSnapshot(snap);
                });

                list.appendChild(el);
```

*(Note: We updated the `el.innerHTML` slightly to fit the checkbox on the left side and prevented the click listener from triggering `selectSnapshot` when clicking the checkbox).*

- [ ] **Step 3: Commit**
```bash
git add www/map/templates_map.html
git commit -m "feat: add mass delete checkboxes for map templates using BulkActions"
```
