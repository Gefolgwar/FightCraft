# КРОК 2: Firebase & Multiplayer Debug - Implementation Plan

**Дата:** 2026-01-27  
**Статус:** IN PROGRESS

---

## ✅ Що Вже Є

1. **Firebase Firestore** - налаштовано і працює
2. **Anonymous Authentication** - автоматичний вхід
3. **Збереження/завантаження гравця** - `savePlayerToCloud()`, `loadPlayerFromCloud()`
4. **Відстеження інших гравців** - `subscribeToPlayers()`
5. **Оновлення локації** - `updatePlayerLocation()`

---

## 🎯 Що Потрібно Зробити

### 1. Debug Menu для Керування Гравцями

**Місце:** Нова секція в Settings Panel

**Функціонал:**
- [ ] Випадаючий список всіх гравців онлайн
- [ ] Кнопка "Create Test Player"
- [ ] Перемикання між гравцями (multi-account debug)
- [ ] Відображення:
  - UID гравця
  - Координати (lat, lng)
  - Рівень і стати
  - Кількість активних гравців

**UI Елемент:**
```html
<div class="debug-player-management p-4">
    <h3>🎮 Player Management</h3>
    
    <div class="current-player">
        <p>Current: <span id="current-uid">...</span></p>
        <p>Position: <span id="current-pos">...</span></p>
    </div>
    
    <div class="players-list">
        <select id="players-dropdown">
            <!-- Dynamic list -->
        </select>
        <button onclick="switchToPlayer()">Switch</button>
    </div>
    
    <div class="actions">
        <button onclick="createTestPlayer()">+ New Test Player</button>
        <button onclick="showAllPlayers()">Show All (map)</button>
    </div>
    
    <div class="stats">
        <p>Online Players: <span id="online-count">0</span></p>
    </div>
</div>
```

---

### 2. Відображення Імен Гравців на Маркерах

**Файл:** `www/js/map.js`

**Зміни:**
```javascript
// У функції updateOtherPlayers() додати:
marker.bindTooltip(`
    <div class="player-tooltip">
        <strong>${player.name}</strong><br>
        Lv. ${player.level} ${player.class}
    </div>
`, { permanent: false, direction: 'top' });
```

**CSS для tooltip:**
```css
.player-tooltip {
    background: rgba(139, 92, 246, 0.95);
    border: 2px solid #8b5cf6;
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 12px;
    text-align: center;
}
```

---

### 3. Real-time Оновлення Позицій

**Вже реалізовано в:**
- `firebase-service.js` → `subscribeToPlayers()`
- `map.js` → `updateOtherPlayers()`

**Потрібно додати:**
- Періодичне оновлення власної позиції (кожні 5 секунд)
- Оптимізація: оновлювати тільки якщо переміщення > 10 метрів

```javascript
let lastSavedPosition = null;

function autoUpdatePlayerPosition() {
    const current = gameState.player.position;
    
    if (!lastSavedPosition || 
        getDistance(lastSavedPosition, current) > 0.01) { // ~10m
        updatePlayerLocation(current.lat, current.lng);
        lastSavedPosition = {...current};
    }
}

setInterval(autoUpdatePlayerPosition, 5000);
```

---

### 4. Database Schema

**Firestore Collections:**

#### `/users/{uid}`
```javascript
{
    // Player Data
    player: {
        name: string,
        level: number,
        class: string,
        xp: string,
        xpToNext: string,
        hp: number,
        maxHp: number,
        gold: number,
        strength: number,
        agility: number,
        // ... інші стати
    },
    
    // Equipment
    equipment: {
        helmet: string | null,
        armor: string | null,
        sword: string | null,
        // ...
    },
    
    // Inventory
    inventory: Array<{id: string, quantity: number}>,
    
    // Position (Real-time)
    position: {
        lat: number,
        lng: number
    },
    
    // Metadata
    lastSave: Timestamp,
    lastLocationUpdate: Timestamp,
    createdAt: Timestamp,
    isTestPlayer: boolean
}
```

---

## 📋 Порядок Реалізації

### Фаза 1: Debug Menu (30 хв)
1. Створити HTML секцію в Settings Panel
2. Додати функції в `firebase-service.js`:
   - `getAllPlayers()`
   - `createTestPlayer(name, position)`
   - `deleteTestPlayer(uid)`
3. Додати UI контролери
4. Стилізувати

### Фаза 2: Player Tooltips (15 хв)
1. Оновити `map.js` → `updateOtherPlayers()`
2. Додати CSS для tooltips
3. Тестування відображення

### Фаза 3: Auto-Updates (10 хв)
1. Додати `autoUpdatePlayerPosition()` в `app.js`
2. Оптимізувати частоту оновлень
3. Тестування синхронізації

### Фаза 4: Testing (15 хв)
1. Створити 2-3 тестових гравці
2. Перевірити відображення на мапі
3. Перевірити синхронізацію позицій
4. Перевірити перемикання між гравцями

**Загальний час:** ~70 хвилин

---

## 🧪 Acceptance Criteria

- [ ] Debug Menu відображається в Settings
- [ ] Можна створити тестового гравця
- [ ] Випадаючий список показує всіх онлайн гравців
- [ ] Можна перемкнутися на іншого гравця (multi-account)
- [ ] На мапі відображаються інші гравці з іменами
- [ ] Tooltip показує ім'я, рівень, клас
- [ ] Позиції оновлюються в real-time
- [ ] Лічильник онлайн гравців працює

---

## 🚀 Готовність до Реалізації

Firebase вже налаштований і працює. Можемо починати!

**Почати з:** Debug Menu UI → Functions → Testing

---

*Next: КРОК 3 - Реальні Місця (Castles & Shops)*
