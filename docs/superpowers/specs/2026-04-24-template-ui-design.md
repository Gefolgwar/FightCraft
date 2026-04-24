# Map Template Management Design Spec

## Overview
Update the `templates_map.html` admin interface and underlying Firebase services to allow toggling map templates (World Snapshots) ON and OFF, and support mass deletion of templates.

## Architecture

### 1. Data Model & Source Tracking
- **Snapshot State:** `world_snapshots` documents will now track their status via an `isActive` boolean (defaulting to `false`).
- **Object Tracking:** When a template is activated, every object written to the `spawned_objects` collection will include a `sourceTemplateId` field mapping back to the snapshot ID.
- **Activation (`applyWorldSnapshot`)**: 
  - Iterates through the snapshot's objects.
  - Injects `sourceTemplateId: snapshotId` into each object.
  - Saves them to `spawned_objects` using `writeBatch`.
  - Updates the snapshot document to `isActive: true`.
- **Deactivation (`deactivateWorldSnapshot`)**: 
  - Queries `spawned_objects` where `sourceTemplateId == snapshotId`.
  - Deletes the retrieved objects via `writeBatch`.
  - Updates the snapshot document to `isActive: false`.

### 2. Sidebar UI (Activation Toggle)
In `templates_map.html`, the template detail view will replace the existing "Apply to Live Map" button with an Activation Toggle switch.
- **State Representation:** The toggle reflects the `isActive` state of the snapshot.
- **Visuals:** A green badge/indicator will appear in the sidebar list for active templates.
- **UX:** Clicking the toggle triggers activation or deactivation, showing a loading state until the batch operations complete.

### 3. Mass Delete UI
Integrate the existing `template-bulk-actions.js` utility into `templates_map.html`.
- **Checkboxes:** Inject a "Select All" header and individual checkboxes for each snapshot in the sidebar list.
- **Action Bar:** Utilize the floating "Delete Selected" bar from `BulkActions`.
- **Deletion Safety:** The `deleteSnapshot` function in `firebase-service.js` must be updated to check if a snapshot is `isActive == true`. If so, it must automatically call `deactivateWorldSnapshot` to clean up the live map before permanently deleting the snapshot document.

## Dependencies
- Firebase Firestore (Read/Write batches)
- `www/firebase/firebase-service.js`
- `www/maintenance/template-bulk-actions.js`
- `www/map/templates_map.html`
