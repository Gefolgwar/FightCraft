# 🚀 FightCraft - Quick Developer Reference

## 🎯 Instant Access

**Local Server:**
```bash
# Запуск локального сервера (з кореня проєкту)
npx firebase serve --only hosting --port 5000
```
**URL:** http://localhost:5000  
**Live:** https://fight-craft-3c3f0.web.app  
**Console Test:** `window.__checkGlobalFunctions()`  
**Version:** v0.5.0 Consolidated

---

## 📁 Key Files

```
D:\Project\FightCraft/
├── firebase.json        ← Firebase config (hosting: www/)
├── package.json         ← Dependencies
├── .gitignore
├── www/                 ← Public hosting directory
│   ├── index.html       ← Main UI
│   ├── css/style.css    ← Styles
│   └── js/
│       ├── app.js           ← Entry point + init
│       ├── ui-controller.js ← UI logic + Online Players
│       ├── map.js           ← Leaflet map + markers
│       ├── gameState.js     ← Game state management
│       ├── combat.js        ← PvE combat system
│       ├── pvp.js           ← PvP combat system
│       ├── firebase-service.js ← Firebase/RTDB
│       ├── data.js          ← Items, monsters DB
│       ├── districts.js     ← District system
│       ├── poi.js           ← Points of interest
│       ├── monsters.js      ← Monster generation
│       └── character-selection.js ← Char switching
├── android/             ← Capacitor Android build
├── firestore.rules
├── database.rules.json
└── storage.rules
```

---

## 🆔 ID Reference

### HUD Elements
```javascript
'player-level'    // Level number
'player-hp'       // HP bar (width %)
'player-hp-text'  // HP text (100/100)
'player-xp'       // XP bar (width %)
'player-xp-text'  // XP text (0/500)
'player-gold'     // Gold amount
```

### Panels
```javascript
'character-panel'  // Hero stats
'inventory-panel'  // Equipment + items
'quests-panel'     // Quest list
'settings-panel'   // Settings + debug
'item-modal'       // Item details
'combat-screen'    // Battle UI
```

### Toggles
```javascript
'sound-toggle'
'notifications-toggle'
'fog-toggle'
'vibration-toggle'
'debug-toggle'
```

### Debug Elements
```javascript
'debug-badge'      // "DEBUG" label
'debug-panel'      // Coords panel
'debug-options'    // Test buttons
'joystick-container'
'speed-control'
```

---

## 🎮 Global Functions

### UI Navigation
```javascript
openMenu('character')  // or 'character-panel'
closeMenu()
toggleEventLog()
clearEventLog()
closeItemModal()
```

### Settings
```javascript
toggleSetting('sound')
toggleDebugMode()
```

### Map
```javascript
centerOnPlayer()
teleportToCoords()
setMoveSpeed(2) // 0.5, 1, 2, 5
```

### Inventory
```javascript
filterInventory('weapon') // 'all', 'armor', 'consumable'
handleEquipSlot('sword')
showItemDetails('sword_iron', 'sword')
equipItem('sword_iron')
useItem('health_potion')
```

### Combat
```javascript
selectAttackZone('head')  // 'body', 'belt', 'legs'
selectDefense('head-body')
executeAttack()
fleeCombat()
closeVictory()
closeDefeat()
```

### Character
```javascript
allocateStat('strength')  // 'agility', 'vitality', etc.
addXP(1000)
```

### Debug/Test
```javascript
spawnTestMonsters()
healPlayer()
giveTestItems()
addTestXP()
addTestGold()
```

---

## 🔍 Common Tasks

### Add New UI Element
1. Add HTML with proper ID
2. Update in `ui-controller.js`
3. Export to `window` if needed
4. Test in console

### Add New Menu Panel
```javascript
// 1. HTML
<div id="new-panel" class="fixed inset-0 z-[2000] hidden">
  <!-- content -->
</div>

// 2. ui-controller.js
const menuMap = {
  'new': 'new-panel'  // Add here
};

// 3. Add to modals array
const modals = [..., 'new-panel'];
```

### Add New Global Function
```javascript
// In appropriate .js file
export function myFunction() { ... }

// In app.js or ui-controller.js
window.myFunction = myFunction;

// Test
window.myFunction()
```

---

## 🐛 Debugging

### Button Not Working?
```javascript
// 1. Check function exists
typeof window.openMenu  // should be "function"

// 2. Check element exists
document.getElementById('character-panel')  // should exist

// 3. Check for errors
// Open Console (F12)

// 4. Manual test
openMenu('character')
```

### Panel Not Opening?
```javascript
// 1. Check hidden class
document.getElementById('character-panel').classList  // should have 'hidden'

// 2. Remove manually
document.getElementById('character-panel').classList.remove('hidden')

// 3. Check z-index
getComputedStyle(document.getElementById('character-panel')).zIndex
```

### HUD Not Updating?
```javascript
// 1. Check IDs match
document.getElementById('player-hp')  // should exist
document.getElementById('player-hp-text')  // should exist

// 2. Manual update
updateHUD()

// 3. Check gameState
console.log(gameState.player)
```

---

## 📊 Quick Diagnostics

### Run in Console:
```javascript
// Full diagnostic
window.__checkGlobalFunctions()

// State check
console.log({
  level: gameState.player.level,
  hp: gameState.player.hp,
  xp: gameState.player.xp,
  gold: gameState.player.gold,
  debug: gameState.debug.enabled,
  items: gameState.inventory.length
})

// Function check
['openMenu', 'closeMenu', 'updateHUD', 'centerOnPlayer']
  .forEach(f => console.log(f, typeof window[f]))
```

---

## ⚡ Hot Reload

### After Code Changes:
```bash
# Just refresh browser
Ctrl + F5  # Hard refresh

# Or in Console
location.reload(true)
```

---

## 🎨 Styling Reference

### Tailwind Classes Used:
```css
/* Panels */
.menu-panel          // Background + blur
.toggle-btn          // Settings toggles
.stat-bar            // HP/XP bars
.item-slot           // Inventory slots
.combat-zone         // Attack buttons

/* Z-Index Layers */
z-[1000]   // HUD
z-[1001]   // Debug
z-[1002]   // Event Log
z-[2000]   // Panels
z-[3000]   // Item Modal
z-[4000]   // Combat
z-[5000]   // Victory/Defeat
z-[99999]  // Loading Screen
```

---

## 📦 Quick Tests

### Test All Buttons:
```javascript
// Run sequentially
openMenu('character'); setTimeout(closeMenu, 1000);
setTimeout(() => openMenu('inventory'), 1500); setTimeout(closeMenu, 2500);
setTimeout(() => openMenu('quests'), 3000); setTimeout(closeMenu, 4000);
setTimeout(() => openMenu('settings'), 4500); setTimeout(closeMenu, 5500);
```

### Test Debug Mode:
```javascript
toggleDebugMode();
setTimeout(toggleDebugMode, 3000);
```

### Test Notifications:
```javascript
['info', 'success', 'warning', 'error'].forEach((type, i) => {
  setTimeout(() => showNotification(`Test ${type}`, type), i * 1000);
});
```

---

## 🔐 Safe Mode

### If Everything Breaks:
```javascript
// 1. Reload fresh
localStorage.clear();
location.reload();

// 2. Check basics
console.log('gameState:', gameState);
console.log('map:', map);

// 3. Reinit if needed
init();
```

---

## 📞 Help

### Quick Links:
- **Local:** http://localhost:5000 (`npx firebase serve --only hosting`)
- **Live:** https://fight-craft-3c3f0.web.app
- **Deploy:** `npx firebase deploy --only hosting`
- **Console:** F12
- **Elements:** F12 → Elements tab
- **Network:** F12 → Network tab

---

## ✅ Pre-Commit Checklist

- [ ] No console errors
- [ ] All buttons work
- [ ] All panels open/close
- [ ] HUD updates correctly
- [ ] Test in Chrome
- [ ] Test in Firefox
- [ ] Test on mobile (if applicable)
- [ ] Documentation updated

---

*Last Updated: 2026-04-05*  
*Version: v0.5.0 Consolidated*  
*Status: ✅ Production Ready*
