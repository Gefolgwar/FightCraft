# 🌐 Директива: Multiplayer Sync Check

> **Мета:** Перевірити синхронізацію мультиплеєра через Firebase RTDB.
> **Чому:** Orphaned записи та listener leaks = гравці бачать "привидів" на карті.

---

## Передумови

- Тригер: зміни в `gameplay/`, `firebase/`, або запит "перевірити мультиплеєр"
- Потрібен доступ до Firebase MCP

## Процедура

### Крок 1: RTDB Health Check
**Виконати:** `execution/rtdb-health.ps1`

Скрипт перевіряє через MCP:
- `/live_players` — чи є stale записи (> 24h без оновлення)
- `/battle_requests` — orphaned запити (pending > 1h)
- `/battles` — незавершені бої
- `/arenas` — арени без активних боїв

### Крок 2: Активувати Skill
**Прочитати:** `.agents/skills/multiplayer-sync/SKILL.md`

Skill містить:
- Архітектуру RTDB вузлів
- Тест-кейси (TC-SYNC-*, TC-PVP-*, TC-GRP-*)
- Патерни проблем (listener leaks, race conditions, onDisconnect)

### Крок 3: Код-аудит
Перевірити файли:
- `www/gameplay/pvp.js` — PvP бої через RTDB
- `www/gameplay/groups.js` — групи гравців
- `www/firebase/firebase-service.js` — RTDB підписки та onDisconnect

Шукати:
```javascript
// 🚩 onValue без збереження unsubscribe
// 🚩 set() замість update() (race conditions)
// 🚩 Відсутній onDisconnect
```

### Крок 4: Звіт
```markdown
## Multiplayer Sync Report — [дата]
### RTDB Health: orphaned records
### Listener Audit: leaks found
### Race Conditions: set() vs update()
### onDisconnect: coverage
```

---

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Skill | `.agents/skills/multiplayer-sync/SKILL.md` |
| Скрипт | `.agents/execution/rtdb-health.ps1` |
| MCP | `realtimedatabase_get_data` |

## При помилці

→ Застосувати протокол `protocols/self-annealing.md`
