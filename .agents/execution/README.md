# 📂 Execution Scripts — README

## Що це?

Папка `execution/` містить **детерміновані** PowerShell скрипти, які виконують конкретні задачі.
Це **Layer 3 (Execution)** архітектури DOE.

## Правила

1. **Кожен скрипт має директиву** — відповідний `.md` файл в `directives/`
2. **Скрипти НЕ хардкодять** чутливі дані — читають з `env/.env`
3. **Кожен скрипт підтримує** `-WhatIf` для dry-run
4. **Exit codes:** `0` = success, `1` = failure
5. **Мова:** Коментарі та вивід — українською

## Доступні скрипти

| Скрипт | Директива | Що робить |
|--------|-----------|-----------|
| `validate-rules.ps1` | `deploy-firebase.md`, `security-audit.md` | Валідація синтаксису 3-х rules файлів |
| `drift-check.ps1` | `deploy-firebase.md`, `security-audit.md` | Порівняння local vs production rules |
| `pre-deploy-gate.ps1` | `deploy-firebase.md` | Повна перевірка перед деплоєм |
| `balance-snapshot.ps1` | `game-balance-audit.md` | Дамп даних балансу з коду |
| `rtdb-health.ps1` | `multiplayer-sync-check.md` | Перевірка RTDB на orphaned записи |

## Як додати новий скрипт

Див. директиву: `.agents/directives/add-execution-script.md`

Коротко:
1. Створити `.ps1` в цій папці
2. Створити `.md` в `directives/`
3. Додати запис в `directives/_index.md`
4. Протестувати з `-WhatIf`

## Запуск

```powershell
# З кореня проекту:
.\.agents\execution\validate-rules.ps1
.\.agents\execution\pre-deploy-gate.ps1 -WhatIf
```
