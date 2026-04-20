# 🎮 Директива: Game Balance Audit

> **Мета:** Перевірити баланс зброї, монстрів, прогресії та XP.
> **Чому:** Дисбаланс = гравці відвалюються (занадто легко) або фрустрація (занадто важко).

---

## Передумови

- Тригер: зміни в `data.js`, `combat.js`, або явний запит "аудит балансу"
- Аудит ТІЛЬКИ ЧИТАЄ. Зміни мають бути затверджені користувачем.

## Процедура

### Крок 1: Snapshot поточних даних
**Виконати:** `execution/balance-snapshot.ps1`

Зчитує:
- `www/gameplay/data.js` — items[], monsters[], levelBonuses[]
- `www/gameplay/combat.js` — формули damage/defense
- `www/core/gameState.js` — totalAttack, totalDefense, HP

### Крок 2: Серверні шаблони
**MCP:**
```
firestore_query_collection(collection_path: "templates/", filters: [])
```
Порівняти локальні дані з серверними шаблонами → знайти розбіжності.

### Крок 3: Активувати Skill
**Прочитати:** `.agents/skills/game-balance/SKILL.md`

Skill містить:
- Метрики балансу для зброї, монстрів, прогресії
- Здорові межі та червоні прапорці
- BigInt XP специфіку

### Крок 4: Звіт
```markdown
## Balance Audit Report — [дата]
### Зброя: damage scaling, cost ratio
### Монстри: HP/XP ratio, spawn density
### Прогресія: XP curve, unlock frequency
### Розбіжності: Local vs Firestore templates
```

---

## ⚠️ BigInt XP

`gameState.player.xp` — **BigInt**. Firestore серіалізує як string.
Будь-який код що працює з XP ПОВИНЕН використовувати BigInt арифметику.

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Skill | `.agents/skills/game-balance/SKILL.md` |
| Скрипт | `.agents/execution/balance-snapshot.ps1` |
| MCP | `firestore_query_collection` |

## При помилці

→ Застосувати протокол `protocols/self-annealing.md`
