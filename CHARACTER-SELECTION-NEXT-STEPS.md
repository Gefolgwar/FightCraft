# 🎯 Character Selection - Наступні Кроки

## ✅ Що Вже Готово

1. ✅ **Firebase Service** - Додано функції для персонажів
   - `getAllCharacters(userId)` 
   - `getCharacter(userId, characterId)`
   - `createCharacter(userId, name, avatar)`
   - `saveCharacter(userId, characterId, data)`
   - `deleteCharacter(userId, characterId)`

2. ✅ **Character Selection UI** - HTML готовий
   - `character-selection-ui.html`
   - Multiplayer Panel для мапи

3. ✅ **Character Selection Logic** - JS модуль готовий
   - `js/character-selection.js`
   - Auto-login з localStorage
   - Створення/видалення персонажів

4. ✅ **Backup System** - Для безпеки
   - `backup.html` - UI tool
   - `backup-firestore.js`
   - `restore-firestore.js`

---

## 🔧 Що Залишилось (2 кроки)

### КРОК A: Інтегрувати в app.js

Потрібно оновити `www/js/app.js`:

#### A1. Додати import на початку файлу:

```javascript
import { initCharacterSelection } from './character-selection.js';
import { saveCharacter, getCharacter } from './firebase-service.js';
```

#### A2. Оновити init() функцію (рядок ~12):

**ЗАМІНИТИ:**
```javascript
async function init() {
    console.log('🎮 Initializing FightCraft...');
    
    const initSuccess = await initFirebase();
    if (!initSuccess) {
        showNotification('Failed to connect to server', 'error');
        return;
    }

    await loadGame();
    // ...решта коду
}
```

**НА:**
```javascript
async function init() {
    console.log('🎮 Initializing FightCraft...');
    
    // Initialize character selection
    const charResult = await initCharacterSelection();
    
    if (!charResult) {
        // User needs to select/create character
        // Game will start when they click on character
        console.log('⏸️ Waiting for character selection...');
        return;
    }
    
    // Character selected - load data
    const { characterId, data } = charResult;
    console.log(`✅ Starting with character: ${data.player.name}`);
    
    // Store character ID globally
    window._currentUserId = getCurrentUser().uid;
    window._currentCharacterId = characterId;
    
    // Load character data into gameState
    Object.assign(gameState, data);

    // Continue with normal init
    await loadGame();
    // ...решта коду залишається як є
}
```

#### A3. Додати функцію для старту гри після вибору персонажа:

**ДОДАТИ після функції init():**

```javascript
/**
 * Start game with selected character
 * Called from character-selection.js
 */
window.startGameWithCharacter = async function(characterId, data) {
    console.log(`🚀 Starting game with: ${data.player.name}`);
    
    const user = getCurrentUser();
    window._currentUserId = user.uid;
    window._currentCharacterId = characterId;
    
    // Load character data into gameState
    Object.assign(gameState, data);
    
    // Continue with normal init
    await loadGame();
    
    // Initialize map
    initMap();
    
    // Subscribe to other players
    subscribeToPlayers((players) => {
        console.log(`👥 Online players: ${players.length}`);
        // Update UI...
        if (window.refreshPlayersList) {
            window.refreshPlayersList();
        }
    });
    
    // Start regeneration
    setInterval(updateRegeneration, 1000);
    
    // Update UI
    updateUI();
    
    console.log('✅ Game started successfully!');
};
```

#### A4. Оновити saveGame() (рядок ~140):

**ЗАМІНИТИ:**
```javascript
export async function saveGame() {
    if (saveTimeout) clearTimeout(saveTimeout);
    
    const playerData = {
        player: gameState.player,
        equipment: gameState.equipment,
        inventory: gameState.inventory,
        position: gameState.position,
        quests: gameState.quests,
        settings: gameState.settings,
        debug: gameState.debug,
        inactiveMonsters: gameState.inactiveMonsters
    };

    localStorage.setItem(SAVE_KEY, JSON.stringify(playerData));
    await savePlayerToCloud(playerData);  // ← СТАРА ФУНКЦІЯ
}
```

**НА:**
```javascript
export async function saveGame() {
    if (saveTimeout) clearTimeout(saveTimeout);
    
    const playerData = {
        player: gameState.player,
        equipment: gameState.equipment,
        inventory: gameState.inventory,
        position: gameState.position,
        quests: gameState.quests,
        settings: gameState.settings,
        debug: gameState.debug,
        inactiveMonsters: gameState.inactiveMonsters
    };

    // Save to localStorage
    localStorage.setItem(SAVE_KEY, JSON.stringify(playerData));
    
    // Save to Cloud (NEW: using characters subcollection)
    if (window._currentUserId && window._currentCharacterId) {
        await saveCharacter(window._currentUserId, window._currentCharacterId, playerData);
    } else {
        // Fallback to old method if character system not initialized
        await savePlayerToCloud(playerData);
    }
}
```

---

### КРОК B: Показати Multiplayer Panel

#### B1. Оновити ui-controller.js

Додати в кінець файлу `www/js/ui-controller.js`:

```javascript
// ==================== MULTIPLAYER PANEL ====================

/**
 * Toggle multiplayer panel
 */
window.toggleMultiplayerPanel = function() {
    const content = document.getElementById('mp-panel-content');
    const toggle = document.getElementById('mp-panel-toggle');
    
    if (!content || !toggle) return;
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        toggle.textContent = '▼';
    } else {
        content.classList.add('hidden');
        toggle.textContent = '▶';
    }
};

/**
 * Multiplayer panel actions (wrappers for existing functions)
 */
window.mpPanelViewPlayer = function() {
    const select = document.getElementById('mp-panel-players');
    if (select && select.value) {
        window.switchToPlayer(); // Uses existing function
    }
};

window.mpPanelDeletePlayer = function() {
    window.deleteSelectedPlayer(); // Uses existing function
};

window.mpPanelShowAll = function() {
    window.showAllPlayersOnMap(); // Uses existing function
};

window.mpPanelCreate = function() {
    window.createTestPlayer(); // Uses existing function
};
```

#### B2. Оновити refreshPlayersList()

Знайти функцію `refreshPlayersList()` і додати оновлення MP Panel:

```javascript
// Існуючий код оновлює mp-players-list
// ДОДАТИ після нього:

// Also update multiplayer panel on map
const panelList = document.getElementById('mp-panel-players');
const panelCount = document.getElementById('mp-panel-count');

if (panelList && players) {
    panelList.innerHTML = '';
    players.forEach(player => {
        const marker = player.isSelf ? '👤 ' : '👥 ';
        const option = document.createElement('option');
        option.value = player.id;
        option.textContent = `${marker}${player.name} (Lv.${player.level})`;
        panelList.appendChild(option);
    });
}

if (panelCount && players) {
    panelCount.textContent = `(${players.length})`;
}
```

#### B3. Показати панель після старту гри

У функції `startGameWithCharacter` додати в кінці:

```javascript
// Show multiplayer panel
const mpPanel = document.getElementById('multiplayer-panel');
if (mpPanel) {
    mpPanel.classList.remove('hidden');
}
```

---

## 🧪 Тестування

Після всіх змін:

1. Очистити localStorage: `localStorage.clear()`
2. Оновити сторінку (F5)
3. Має показатись Character Selection Screen
4. Створити персонажа
5. Гра має запуститись
6. Multiplayer Panel має бути видимою справа вгорі
7. Ctrl+F5 (hard refresh) - має автоматично завантажити персонажа

---

## 📝 Коротко

**Файли для редагування:**

1. `www/js/app.js` - Оновити init, saveGame, додати startGameWithCharacter
2. `www/js/ui-controller.js` - Додати MP Panel functions

**Орієнтовний час:** 20-30 хвилин

**Готовий продовжувати?**
