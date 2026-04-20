# 🔒 Директива: Security Audit

> **Мета:** Перевірити Firebase Security Rules на вразливості.
> **Чому:** Firebase Rules — єдиний сервер. Вразливість = повний доступ до даних.

---

## Передумови

- Тригер: зміни в rules файлах, перед деплоєм, або явний запит
- Аудит ТІЛЬКИ ЧИТАЄ. Ніколи не модифікує rules автоматично.

## Процедура

### Крок 1: Зчитати актуальний стан rules
**Виконати:** `execution/validate-rules.ps1`

Файли для аналізу:
| Файл | Мова правил |
|------|-------------|
| `firebase/firestore.rules` | Rules Language v2 |
| `firebase/database.rules.json` | JSON Rules |
| `firebase/storage.rules` | Rules Language v2 |

### Крок 2: Активувати Skill
**Прочитати:** `.agents/skills/security-audit/SKILL.md`

Skill містить повний чекліст:
- 🔴 CRITICAL: permissive writes, open rules, missing validate, hardcoded UIDs
- 🟡 WARNINGS: overly broad read, no rate limiting, GPS range
- 🟢 BEST PRACTICES: field-level protection, admin claims, server timestamps

### Крок 3: Drift Detection
**Виконати:** `execution/drift-check.ps1`

Порівняти локальні rules з продакшн → знайти drift.

### Крок 4: Звіт
Створити Security Audit Report з секціями 🔴/🟡/🟢.
Формат:
```markdown
## Security Audit Report — [дата]
### 🔴 CRITICAL (блокує деплой)
### 🟡 WARNINGS
### 🟢 RECOMMENDATIONS
### Drift: Local vs Production
```

---

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Skill | `.agents/skills/security-audit/SKILL.md` |
| Скрипт | `.agents/execution/validate-rules.ps1` |
| Скрипт | `.agents/execution/drift-check.ps1` |
| MCP | `firebase_validate_security_rules`, `firebase_get_security_rules` |

## При помилці

→ Застосувати протокол `protocols/self-annealing.md`
