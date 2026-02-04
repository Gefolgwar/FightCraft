# 🧪 FightCraft UI Testing Checklist

## Швидкий Старт
1. Відкрийте браузер: **http://localhost:8080**
2. Відкрийте Console (F12)
3. Перевірте наявність помилок

---

## ✅ Тести Основних Функцій

### 1. Завантаження Гри
- [ ] Loading screen з'являється
- [ ] Progress bar заповнюється
- [ ] Гра завантажується без помилок в консолі
- [ ] Loading screen зникає після завантаження

### 2. HUD (Головний Дисплей)
- [ ] Відображається рівень гравця
- [ ] HP bar показує 100/100
- [ ] XP bar показує 0/500
- [ ] Золото відображається (0)
- [ ] Regen індикатор (+) видимий

### 3. Нижнє Меню (Bottom Bar)
- [ ] 5 кнопок видимі: Hero, Items, 📍, Quests, Menu
- [ ] Кнопка 📍 по центру піднята вгору
- [ ] Hover ефекти працюють

### 4. Кнопка 📍 (Center on Player)
- [ ] Клік центрує карту на гравця
- [ ] З'являється сповіщення
- [ ] Карта анімується

### 5. Character Panel (Hero Button)
**Кнопка:** 👤 Hero
- [ ] Панель відкривається
- [ ] Аватар 🧙 відображається
- [ ] Wanderer Level 1 показано
- [ ] XP: 0 / 500
- [ ] Base Stats показані (всі по 5)
- [ ] Derived Stats показані
- [ ] Кнопка ✕ закриває панель
- [ ] Клік поза панеллю закриває її

### 6. Inventory Panel (Items Button)
**Кнопка:** 🎒 Items
- [ ] Панель відкривається
- [ ] Equipment slots відображаються
- [ ] Центральний персонаж 🧙 видимий
- [ ] Derived stats справа
- [ ] Filter buttons (All, Weapons, Armor, Resources)
- [ ] Inventory grid порожній
- [ ] Gold: 0 внизу
- [ ] Закривається правильно

### 7. Quests Panel
**Кнопка:** 📜 Quests
- [ ] Панель відкривається
- [ ] 4 квести відображаються:
  - [ ] 🗡️ First Steps (0/5)
  - [ ] 📦 Collector (0/10)
  - [ ] 👑 Boss Slayer (0/3)
  - [ ] 🌍 Traveler (0/1000m)
- [ ] Progress bars на 0%
- [ ] Rewards показані
- [ ] Закривається правильно

### 8. Settings Panel (Menu Button)
**Кнопка:** ⚙️ Menu
- [ ] Панель відкривається
- [ ] Sound toggle (ON)
- [ ] Notifications toggle (ON)
- [ ] Fog of War toggle (ON)
- [ ] Vibration toggle (ON)
- [ ] Debug Mode toggle (OFF)
- [ ] Reset progress button
- [ ] Всі toggles клікабельні
- [ ] Закривається правильно

### 9. Event Log
**Кнопка:** 📋 (праворуч внизу)
- [ ] Кнопка видима
- [ ] Клік відкриває панель
- [ ] Event Log заголовок
- [ ] Clear та ✕ buttons
- [ ] Логи відображаються
- [ ] Закривається правильно

### 10. Notifications
**Тест:** Будь-яка дія має показувати сповіщення
- [ ] Notifications з'являються праворуч вгорі
- [ ] Автоматично зникають
- [ ] Різні кольори для різних типів:
  - Info: синій
  - Success: зелений
  - Warning: жовтий
  - Error: червоний

---

## 🔧 Debug Mode Тести

### Активація Debug Mode
1. Відкрити Settings (⚙️)
2. Клікнути Debug Mode toggle
3. Перевірити зміни

### Debug Elements
- [ ] 🔧 DEBUG badge з'являється вгорі ліворуч
- [ ] Debug Panel з координатами
- [ ] Joystick внизу ліворуч
- [ ] Speed Control кнопки
- [ ] Debug Options в Settings

### Debug Panel
- [ ] LAT: відображає широту
- [ ] LNG: відображає довготу
- [ ] 🏙️ City: показує місто або "Loading..."
- [ ] 🏃 Speed: показує швидкість (1x)
- [ ] Teleport inputs працюють
- [ ] Teleport кнопка функціональна

### Testing Tools (в Settings)
**При увімкненому Debug Mode:**
- [ ] 🧪 Regenerate monsters
  - Клік регенерує монстрів
  - Сповіщення про успіх
- [ ] ❤️ Full heal
  - HP відновлюється до максимуму
  - HUD оновлюється
- [ ] 🎁 Give test items
  - Items додаються в інвентар
  - Inventory оновлюється
- [ ] ⭐ +1000 XP
  - XP збільшується
  - Progress bar оновлюється
- [ ] 💰 +500 gold
  - Gold збільшується
  - HUD оновлюється

### Speed Control
- [ ] 4 кнопки: 0.5x, 1x, 2x, 5x
- [ ] Клік змінює швидкість
- [ ] Active state відображається
- [ ] Сповіщення показується

### Joystick
- [ ] Joystick видимий
- [ ] Knob можна перетягувати
- [ ] Гравець рухається (якщо працює)

---

## 🎮 Console Tests

Відкрийте Console (F12) та виконайте:

```javascript
// Перевірка глобальних функцій
window.__checkGlobalFunctions()

// Тест навігації
openMenu('character')
closeMenu()

// Тест налаштувань
toggleSetting('sound')
toggleDebugMode()

// Тест повідомлень
showNotification('Test message', 'info')

// Тест інвентаря
filterInventory('weapon')

// Тест XP
addXP(100)

// Перевірка gameState
console.log(gameState)
```

### Очікувані Результати
- [ ] Всі функції існують (не `undefined`)
- [ ] Функції виконуються без помилок
- [ ] UI оновлюється правильно
- [ ] gameState містить правильні дані

---

## 🐛 Відомі Проблеми

### Якщо щось не працює:

1. **Кнопки не реагують:**
   - Перевірте Console на помилки
   - Запустіть `window.__checkGlobalFunctions()`
   - Перезавантажте сторінку (Ctrl+F5)

2. **Панелі не відкриваються:**
   - Перевірте ID елементів
   - Перевірте наявність `hidden` class
   - Перевірте z-index

3. **HUD не оновлюється:**
   - Перевірте ID: `player-hp`, `player-xp`, `player-gold`
   - Запустіть `updateHUD()` в консолі

4. **Debug Mode не працює:**
   - Перевірте `gameState.debug.enabled`
   - Запустіть `toggleDebugMode()` в консолі

---

## ✨ Швидка Діагностика

Вставте в Console:

```javascript
// Швидка перевірка всього
console.log('=== FightCraft Quick Diagnostic ===');
console.log('Version: v0.4.0');
console.log('Debug Mode:', gameState.debug.enabled);
console.log('Player Level:', gameState.player.level);
console.log('Player HP:', gameState.player.hp);
console.log('Player Gold:', gameState.player.gold);
console.log('Inventory Items:', gameState.inventory.length);
console.log('Available Functions:');
window.__checkGlobalFunctions();
```

---

## 📊 Success Criteria

✅ **PASS** якщо:
- 0 errors в Console
- Всі кнопки клікабельні
- Всі панелі відкриваються/закриваються
- Debug Mode працює
- Test tools функціональні

❌ **FAIL** якщо:
- JavaScript errors в Console
- Кнопки не реагують
- Панелі не відкриваються
- Функції undefined

---

**Last Updated:** 2026-01-27  
**Tested By:** ___________  
**Result:** ⬜ PASS ⬜ FAIL  
**Notes:** ____________________________________
