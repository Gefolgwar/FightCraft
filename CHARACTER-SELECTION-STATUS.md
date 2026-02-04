# 🎭 Впровадження Системи Вибору Персонажа

## ✅ Виконано (Крок 1/3)

### Створені файли:

1. **`www/character-selection-ui.html`**
   - UI для вибору персонажа перед грою
   - Multiplayer панель для мапи (замість Debug меню)

2. **`www/js/character-selection.js`**
   - Логіка вибору/створення персонажів
   - Збереження в localStorage
   - Auto-login для збережених персонажів

3. **`CHARACTER-SELECTION-PLAN.md`**
   - Детальний план впровадження

---

## 🔨 Наступні Кроки (Крок 2/3)

### 2.1 Оновити Firebase Service

Потрібно додати функції для роботи з персонажами:

```javascript
// firebase-service.js - NEW FUNCTIONS:

// Get all characters for a user
export async function getAllCharacters(userId)

// Get specific character
export async function getCharacter(userId, characterId)

// Create new character
export async function createCharacter(userId, name, avatar)

// Save character data
export async function saveCharacter(userId, characterId, data)

// Delete character
export async function deleteCharacter(userId, characterId)
```

**Нова структура Firestore:**
```
users/{userId}/characters/{characterId}/
  ├── player: { name, level, avatar, ... }
  ├── inventory: [...]
  ├── equipment: { ... }
  └── position: { lat, lng }
```

### 2.2 Оновити app.js

Змінити `init()` функцію:

```javascript
async function init() {
    // 1. Show loading screen
    
    // 2. Initialize character selection
    const charResult = await initCharacterSelection();
    
    if (!charResult) {
        // Wait for user to select character
        // Game will start when user clicks on character
        return;
    }
    
    // 3. Load character data into gameState
    const { characterId, data } = charResult;
    Object.assign(gameState, data);
    window._currentCharacterId = characterId;
    
    // 4. Continue with normal init...
    await loadGame();
    initMapAndUI();
    // etc...
}

// New function to start game after character selection
window.startGameWithCharacter = async function(characterId, data) {
    Object.assign(gameState, data);
    window._currentCharacterId = characterId;
    
    await loadGame();
    initMapAndUI();
    // etc...
};
```

### 2.3 Оновити Saving/Loading

Змінити `saveGame()` і `loadGame()`:

```javascript
// OLD:
await savePlayerToCloud(playerData);  // saves to users/{uid}

// NEW:
await saveCharacter(userId, characterId, playerData);  // saves to users/{uid}/characters/{charId}
```

---

## 🔮 Фінальний Крок (Крок 3/3)

### 3.1 Multiplayer Panel Integration

Перемістити multiplayer UI з `settings-panel` на мапу:

1. Видалити `<div id="mp-debug">` з settings-panel
2. UI вже створено в `character-selection-ui.html`
3. Додати обробники:

```javascript
// ui-controller.js - ADD:

window.toggleMultiplayerPanel = function() {
    const content = document.getElementById('mp-panel-content');
    const toggle = document.getElementById('mp-panel-toggle');
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        toggle.textContent = '▼';
    } else {
        content.classList.add('hidden');
        toggle.textContent = '▶';
    }
};

window.mpPanelViewPlayer = function() {
    const select = document.getElementById('mp-panel-players');
    if (select.value) {
        window.switchToPlayer();  // Use existing function
    }
};

window.mpPanelDeletePlayer = function() {
    window.deleteSelectedPlayer();  // Use existing function
};

window.mpPanelShowAll = function() {
    window.showAllPlayersOnMap();  // Use existing function
};

window.mpPanelCreate = function() {
    window.createTestPlayer();  // Use existing function
};
```

### 3.2 Sync Multiplayer Panel

Зв'язати `mp-players-list` (settings) з `mp-panel-players` (map):

```javascript
// ui-controller.js - UPDATE refreshPlayersList():

export async function refreshPlayersList() {
    // ... existing code ...
    
    // Update BOTH dropdowns
    const mainList = document.getElementById('mp-players-list');
    const panelList = document.getElementById('mp-panel-players');
    
    [mainList, panelList].forEach(listEl => {
        if (!listEl) return;
        listEl.innerHTML = '';
        players.forEach(player => {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = `${marker}${player.name} (Lv.${player.level})`;
            listEl.appendChild(option);
        });
    });
    
    // Update both counts
    const mainCount = document.getElementById('mp-online-count');
    const panelCount = document.getElementById('mp-panel-count');
    const count = players.length.toString();
    if (mainCount) mainCount.textContent = count;
    if (panelCount) panelCount.textContent = `(${count})`;
}
```

---

## 📝 Що потрібно зробити вручну

### 1. Додати UI в index.html

В `index.html`, після `<body>` тегу, додати:

```html
<!-- Load Character Selection UI on page load -->
<script>
document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('character-selection-ui.html');
    const html = await response.text();
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Insert character screen
    const charScreen = temp.querySelector('#character-selection-screen');
    if (charScreen) {
        document.body.insertBefore(charScreen, document.body.firstChild);
    }
    
    // Insert multiplayer panel
    const mpPanel = temp.querySelector('#multiplayer-panel');
    if (mpPanel) {
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.appendChild(mpPanel);
        }
    }
});
</script>
```

### 2. Імпортувати character-selection в app.js

```javascript
// At top of app.js:
import { initCharacterSelection } from './character-selection.js';
```

### 3. Видалити mp-debug з settings-panel

В `index.html`, видалити `<div id="mp-debug">` (рядки 706-772).

---

## 🧪 Тестування

Після впровадження, перевірити:

1. ✅ Перше завантаження показує character selection
2. ✅ Можна створити персонажа
3. ✅ Можна вибрати персонажа
4. ✅ Hard refresh (Ctrl+F5) відновлює останнього персонажа
5. ✅ Multiplayer панель на мапі працює
6. ✅ Немає дублікатів персонажів

---

## ⚠️ Важливо!

- Це **великий рефакторинг** структури даних
- Старі дані (users/{uid}) будуть **несумісні**
- Рекомендую **створити backup** існуючих даних
- Або напишіть **міграційний скрипт**

---

## 🚀 Готовність

**Поточний статус:** 30% виконано

Файли створено, але потрібно:
1. Оновити Firebase Service (додати функції для персонажів)
2. Оновити app.js (новий init flow)
3. Інтегрувати UI в index.html
4. Оновити saveGame/loadGame

**Час на завершення:** ~1-2 години

Продовжити?
