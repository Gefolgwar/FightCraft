---
description: # 🚀 Workflow: FightCraft Parallel Development
---

# 🚀 Workflow: FightCraft Parallel Development

## [Крок 1] ARCHITECT_PHASE
- **Agent:** Architect
- **Input:** Запит користувача + Контекст проекту
- **Instruction:** Створити MD-план архітектури.
- **Wait:** Чекати на підтвердження ("OK").

## [Крок 2] CODING_PHASE
- **Agent:** Coder
- **Input:** Затверджений план + Filesystem MCP
- **Instruction:** Реалізувати код для Unity та NestJS.

## [Крок 3] PARALLEL_REVIEW (The Video Style)
Виконати ОДНОЧАСНО в трьох різних потоках:

1. **Thread A (Security):** Рев'ю безпеки транзакцій та GPS-даних.
2. **Thread B (Logic):** Рев'ю логіки захоплення зон та бойової системи.
3. **Thread C (Performance):** Рев'ю використання пам'яті в Unity та запитів до БД.



## [Крок 4] AGGREGATION & FIXES
- **Action:** Зібрати всі фідбеки.
- **If "FAIL":** Повернути код на доопрацювання Coder-у.
- **If "PASS":** Видати фінальний результат і опис того, що було змінено в проекті.