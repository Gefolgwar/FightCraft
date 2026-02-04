# 🔧 Debugging Guide: Players Not Showing on Map

**Дата:** 2026-01-28  
**Проблеми:**
1. ❌ Firestore permissions error
2. ❌ Players not showing on map

---

## Problem 1: Firebase Permissions ✅ FIXED

**Error:** `Missing or insufficient permissions`

**Solution:** Firestore Rules створені в `firestore.rules`

### Deploy Rules Manually:

**Option 1: Firebase CLI**
```bash
firebase deploy --only firestore:rules
```

**Option 2: Firebase Console**
1. Open https://console.firebase.google.com/project/fight-craft-3c3f0/firestore/rules
2. Copy-paste from `firestore.rules` file:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        request.auth.uid == userId ||
        request.resource.data.isTestPlayer == true
      );
      allow create: if request.auth != null;
      allow delete: if request.auth != null && 
                      resource.data.isTestPlayer == true;
    }
  }
}
```

3. Click "Publish"

---

## Problem 2: Players Not Showing on Map

### Debug Steps:

#### Step 1: Check Console
Open browser console (F12) and look for:

```
✅ EXPECT: "Player spotted: TestPlayerXXX"
❌ ERROR: Any JavaScript errors?
```

#### Step 2: Check Subscription
In console, type:
```javascript
// Check if subscription is active
window._playerSubscription

// Manually trigger update
import('./firebase-service.js').then(m => {
    m.getAllPlayersForDebug().then(players => {
        console.log('Players:', players);
        window.updateOtherPlayers(players);
    });
});
```

#### Step 3: Check Firebase Data
1. Open Firebase Console
2. Firestore Database → users collection  
3. Verify test player has valid `position` field:
```json
{
  "position": {
    "lat": 50.4501,
    "lng": 30.5234
  }
}
```

#### Step 4: Force Render
In console:
```javascript
// Get test data
const testPlayer = {
    id: 'test123',
    name: 'TestPlayer',
    level: 5,
    position: { lat: 50.4501, lng: 30.5234 }
};

// Force render
window.updateOtherPlayers([testPlayer]);
```

---

## Quick Fix: Enable Real-time Sync

Add to `app.js` init() function:

```javascript
// After initFirebase()
let playerUnsubscribe = null;

async function startPlayerSync() {
    const { subscribeToPlayers } = await import('./firebase-service.js');
    const { updateOtherPlayers } = await import('./map.js');
    
    playerUnsubscribe = subscribeToPlayers((players) => {
        console.log('📡 Players update:', players);
        updateOtherPlayers(players);
    });
}

// Call after map init
startPlayerSync();
```

---

## Verification Checklist

After fixing:

```
☐ 1. Firebase Rules deployed
☐ 2. Can create test player without error
☐ 3. Test player appears in dropdown
☐ 4. Test player visible on map with 👤 icon
☐ 5. Player name shows above icon
☐ 6. Console shows "Player spotted: TestPlayerXXX"
☐ 7. Multiple players visible simultaneously
```

---

## Common Issues

### Issue: "Player spotted" but no marker
**Cause:** Map not initialized yet  
**Fix:** Ensure `subscribeToPlayers` called AFTER `initMap()`

### Issue: Marker appears then disappears
**Cause:** Player has no `position.lat` or `position.lng`  
**Fix:** Check Firebase data structure

### Issue: Markers don't update position
**Cause:** Subscription not receiving updates  
**Fix:** Check Firestore listeners in Network tab

---

## Testing Commands

```javascript
// 1. Check current state
console.log('Map:', window.map);
console.log('Other players:', window.otherPlayerMarkers);

// 2. Create marker manually
const L = window.L;
const testMarker = L.marker([50.4501, 30.5234], {
    icon: L.divIcon({
        html: '<div>👤 TEST</div>',
        iconSize: [40, 40]
    })
}).addTo(window.map);

// 3. Check subscription
import('./firebase-service.js').then(m => {
    m.subscribeToPlayers(players => {
        console.log('Real-time update:', players);
    });
});
```

---

**Status:** Awaiting Firebase Rules Deployment  
**Next:** Test after rules deployed
