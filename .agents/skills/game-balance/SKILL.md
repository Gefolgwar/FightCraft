---
name: game-balance
description: "Аудит балансу ігрових предметів, зброї, монстрів та прогресії. Порівнює статичні дані в коді з шаблонами у Firestore. Активується при змінах у data.js, combat.js, або за запитом 'аудит балансу'."
---

# 🎮 Game Balance Auditor

## Динамічний контекст

Перед аналізом ОБОВ'ЯЗКОВО зчитай актуальні дані:

```powershell
# Статична база предметів та монстрів
Get-Content "www\gameplay\data.js" -TotalCount 200

# Формули бою
Select-String -Pattern "damage|defense|calculateDamage|addXP" "www\gameplay\combat.js"

# Stat recalculation
Select-String -Pattern "totalAttack|totalDefense|recalc" "www\core\gameState.js"

# Структура gameplay
Get-ChildItem "www\gameplay" -Name
```

## Джерела даних

### Локальні файли
| Файл | Що містить |
|------|------------|
| `www/gameplay/data.js` | items[] (зброя, броня, зілля), monsters[], levelBonuses[] |
| `www/gameplay/combat.js` | Формули damage, defense, XP rewards |
| `www/core/gameState.js` | totalAttack, totalDefense, HP формули |
| `www/gameplay/battle-logic.js` | PvP zone-based combat (head/body/belt/legs) |

### Firebase (через MCP)
```
# Серверні шаблони
firestore_query_collection(collection_path: "templates/", filters: [])

# Заспавнені об'єкти
firestore_list_documents(parent: "projects/fight-craft-3c3f0/databases/(default)/documents", collectionId: "spawned_objects", pageSize: 20)

# Зони міста
firestore_query_collection(collection_path: "city_zones/", filters: [])
```

## Метрики балансу

### Зброя (Weapons)
| Метрика | Здорова межа | 🚩 Червоний прапорець |
|---------|--------------|----------------------|
| Damage per level | +2..+5 | > +10 (power creep) |
| Max/Min damage ratio | < 3x | > 5x |
| Damage vs Defense scaling | Лінійне | Експоненційне |
| Cost scaling | Геометр. (1.5x) | Лінійне (p2w) |

### Монстри (Monsters)
| Метрика | Здорова межа | 🚩 Червоний прапорець |
|---------|--------------|----------------------|
| HP per zone level | +20..+50 | > +100 (sponge) |
| XP vs difficulty | Лінійне | High XP + low HP |
| Damage vs player HP | 10-25% per hit | > 50% (one-shot) |
| Spawn density | 3-8 per zone | > 20 (lag) or < 1 |

### Прогресія
| Метрика | Здорова межа | 🚩 Червоний прапорець |
|---------|--------------|----------------------|
| XP curve | Експонент. (1.5-2x) | > 3x (wall) or < 1.2x |
| New item unlock | Кожні 2-3 рівні | > 5 рівнів без контенту |

## Алгоритм

```
1. ЗЧИТАЙ: www/gameplay/data.js → парсити items[], monsters[]
2. MCP: firestore_query_collection("templates/") → серверні шаблони
3. ПОРІВНЯЙ: Local data.js vs Firestore templates → знайти розбіжності
4. АНАЛІЗУЙ: метрики балансу (таблиці вище)
5. ЗЧИТАЙ: combat.js + battle-logic.js → edge cases у формулах
6. ЗВІТ: Balance Audit Report
```

## XP — BigInt

⚠️ `gameState.player.xp` зберігається як **BigInt**. Firestore серіалізує як string. Будь-який код, що працює з XP, ПОВИНЕН використовувати BigInt арифметику.

> **Навик тільки читає та аналізує. Зміни мають бути затверджені користувачем.**
