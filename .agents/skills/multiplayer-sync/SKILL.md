---
name: multiplayer-sync
description: "Аудит та тестування мультиплеєрної синхронізації через Firebase RTDB. Покриває live_players, PvP бої, групи, арени. Активується при змінах у gameplay/ або firebase/, або за запитом 'перевірити мультиплеєр'."
---

# 🌐 Multiplayer Sync — RTDB Audit & Testing

## Динамічний контекст

Перед аналізом ОБОВ'ЯЗКОВО зчитай актуальний стан:

```powershell
# Структура gameplay модулів
Get-ChildItem "www\gameplay" -Name

# Структура firebase модулів  
Get-ChildItem "www\firebase" -Name

# PvP модуль — перші 50 рядків
Get-Content "www\gameplay\pvp.js" -TotalCount 50

# Firebase service — RTDB секції
Select-String -Pattern "ref\(|onValue|onDisconnect|set\(|update\(" "www\firebase\firebase-service.js"

# RTDB rules — активні вузли
Get-Content "database.rules.json"
```

## Архітектура RTDB

| Вузол | Файл клієнта | Призначення |
|-------|--------------|-------------|
| `live_players/$charId` | `firebase-service.js` | Позиції гравців на карті (lat/lng/name/level) |
| `battle_requests/$battleId` | `pvp.js` | PvP виклики (pending/accepted/declined) |
| `battles/$battleId` | `pvp.js` | Активні PvP бої (раунди, ходи) |
| `groups/$groupId` | `groups.js` | Групи гравців (leader, members) |
| `arenas/$arenaId` | `pvp.js` | Арени на карті (center lat/lng) |

## MCP-інструменти для діагностики

```
# Позиції всіх гравців
realtimedatabase_get_data(path: "/live_players")

# Активні PvP запити
realtimedatabase_get_data(path: "/battle_requests")

# Поточні бої
realtimedatabase_get_data(path: "/battles")

# Групи
realtimedatabase_get_data(path: "/groups")

# Арени
realtimedatabase_get_data(path: "/arenas")
```

## Тест-кейси

### Позиції гравців (live_players)
```
TC-SYNC-001: Гравець логіниться → запис у /live_players/$charId з lat/lng/name
TC-SYNC-002: Гравець рухається → lat/lng оновлюються в real-time
TC-SYNC-003: Гравець закриває вкладку → onDisconnect видаляє запис
TC-SYNC-004: Два гравці онлайн → обидва бачать маркери один одного
TC-SYNC-005: GPS координати — числа, не рядки
```

### PvP Combat (battle_requests + battles)
```
TC-PVP-001: Виклик → battle_request створюється
TC-PVP-002: Прийняття → battle починається, обидва бачать combat screen
TC-PVP-003: Ходи → раунд розраховується, HP оновлюється
TC-PVP-004: Disconnect → opponent отримує повідомлення
TC-PVP-005: Draw → обидва на 0 HP — коректне завершення
TC-PVP-006: Page refresh → стан відновлюється або очищується
TC-PVP-007: Чужий хід → RTDB rules блокують модифікацію
```

### Групи (groups)
```
TC-GRP-001: Створення групи → leader записується
TC-GRP-002: Join → member додається до масиву
TC-GRP-003: Leave → member видаляється
TC-GRP-004: Leader leaves → група видаляється або transfered
```

## Патерни проблем

### Listener Leaks
```javascript
// 🚩 ПОГАНО: listener не відписується при unmount
onValue(ref(db, '/live_players'), callback);

// ✅ ДОБРЕ: зберігати unsubscribe
const unsub = onValue(ref(db, '/live_players'), callback);
// При cleanup: unsub();
```

### Race Conditions
```javascript
// 🚩 ПОГАНО: set() перезаписує весь об'єкт
set(ref(db, `/battles/${id}`), newData);

// ✅ ДОБРЕ: update() змінює тільки потрібні поля
update(ref(db, `/battles/${id}`), { [`moves/${round}/${charId}`]: move });
```

### onDisconnect Cleanup
```javascript
// Перевірити що onDisconnect встановлений ОДРАЗУ після login
onDisconnect(playerRef).remove();
```

## Console Testing API

```javascript
// В browser DevTools:
window.__checkGlobalFunctions()     // Список глобальних функцій
window.gameState.player             // Стан гравця
window.getLivePlayersOnMap()         // Активні гравці на карті
window.startCombat(monsterId)       // PvE бій
```

> **Навик тільки читає та аналізує. Зміни мають бути затверджені користувачем.**
