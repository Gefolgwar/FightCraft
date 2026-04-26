# Directive: Template-Sync

## Overview

Real-time synchronization protocol between the World Generation admin tools and Firebase, ensuring all template state changes (create, activate, deactivate, delete) are reflected in the DOM without page refreshes.

## Scope

- **Admin UI** (`www/map/templates_map.html`, `www/maintenance/admin.html`)
- **Firebase Service** (`www/firebase/firebase-service.js`)
- **World Generator** (`www/maintenance/admin-world.js`)

## Protocol Steps

### 1. Generation Phase
When `window.generateGlobalWorld()` is invoked:
1. Fetch city population via Overpass API
2. Generate objects per city using templates from Firestore
3. Save each city's objects as a `world_snapshot` document via `saveWorldSnapshot()`
4. Firestore `onSnapshot` listener auto-detects new documents
5. Admin sidebar re-renders without manual refresh

### 2. Activation Phase
When admin toggles a snapshot to **Active**:
1. `applyWorldSnapshot(snapshotId)` reads the snapshot
2. Injects `sourceTemplateId` into each object
3. Batch-writes objects to `spawned_objects` collection
4. Marks snapshot as `isActive: true`
5. Updates `world_metadata/current_state` timestamp
6. **Does NOT clear** IndexedDB cache or `_spawnedObjectsCache`
7. Game clients detect the metadata timestamp change on next sync cycle

### 3. Deactivation Phase
When admin toggles a snapshot to **Inactive**:
1. `deactivateWorldSnapshot(snapshotId)` queries `spawned_objects` where `sourceTemplateId == snapshotId`
2. Batch-deletes matching objects
3. Marks snapshot as `isActive: false`
4. Sidebar updates via `onSnapshot` listener

### 4. Real-Time Listener Lifecycle
- Listener starts on `DOMContentLoaded` in admin pages
- Returns an unsubscribe function stored as `_snapshotUnsubscribe`
- Cleaned up on page unload (best-effort)
- localStorage cache (`admin_snapshots_list`) invalidated on each snapshot event

## Error Handling (Self-Annealing)

If a Firebase operation fails:
1. Log the error with full context
2. Show user notification with retry option
3. Do NOT retry automatically (admin actions are destructive)
4. If `onSnapshot` listener disconnects, attempt reconnect after 5s

## Security Requirements

All write operations to `world_snapshots`, `spawned_objects`, `world_metadata`, `templates` are gated by:
```
function isAdmin() {
  return request.auth.token.admin == true ||
         request.auth.uid == 'YshG61RxTIczGXOfFqiu2wqC63r2' ||
         get(users/{uid}).data.role == 'admin';
}
```
