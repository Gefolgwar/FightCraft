# 📋 Implementation Plan: Character Selection & Multiplayer UI

## Objective
1. Add character selection screen on login
2. Move multiplayer UI from settings to map
3. Prevent duplicate characters on hard refresh

## Changes Required

### 1. Character Selection UI (`index.html`)
```html
<!-- Character Selection Screen (before game loads) -->
<div id="character-selection-screen">
  - Show list of existing characters
  - "Create New Character" option
  - Character preview (name, level, avatar)
  - "Select" button
</div>
```

### 2. Multiplayer UI on Map (`index.html`)
```html
<!-- Floating Multiplayer Panel (top-right of map) -->
<div id="multiplayer-panel" class="absolute top-24 right-3">
  - Collapsible panel
  - Online players count
  - Players list
  - Quick actions
</div>
```

### 3. Character Management (`firebase-service.js`)
```javascript
// New functions:
- getAllCharacters(userId) // Get all characters for this Firebase user
- createNewCharacter(name, avatar)  // Create character
- selectCharacter(characterId)  // Mark as selected
```

### 4. Local Storage (`app.js`)
```javascript
localStorage.setItem('selectedCharacterId', characterId);
localStorage.getItem('selectedCharacterId');
```

### 5. Init Flow (`app.js`)
```
1. Firebase Auth (anonymous)
2. Check localStorage for selectedCharacterId
3. If none → Show Character Selection
4. If exists → Load that character
5. Start game
```

## File Structure
```
www/
├── index.html (add character selection UI + multiplayer panel)
├── js/
│   ├── app.js (update init flow)
│   ├── firebase-service.js (add character management)
│   └── ui-controller.js (add character selection handlers)
```

## Implementation Order
1. ✅ Update Firebase auth to use persistent UIDs
2. ⬜ Create character selection UI
3. ⬜ Add character management to Firebase
4. ⬜ Update app.js init flow
5. ⬜ Move multiplayer UI to map
6. ⬜ Test & polish

## Status: Planning Complete
Next: Start implementation
