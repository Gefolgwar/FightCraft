---
name: deploy-check
description: "Pre-deployment safety checks для Firebase Hosting та Security Rules. Замінює старий /deploy-firebase command. Активується перед деплоєм або за запитом 'деплой', 'deploy'."
---

# 🚀 Deploy Check — Firebase Safety Gate

## Динамічний контекст

Перед деплоєм ОБОВ'ЯЗКОВО зчитай та перевір:

```powershell
# Перевірка на permissive rules (БЛОКУЄ ДЕПЛОЙ якщо знайдено)
Select-String -Pattern "if true" firestore.rules,database.rules.json,storage.rules

# Перевірка isAdmin() цілісності
Select-String -Pattern "isAdmin" firestore.rules

# Перевірка firebase.json
Get-Content "firebase.json"

# Git status — що змінилося
git diff --name-only HEAD~1 2>$null
```

## Процедура деплою

### Крок 1: Pre-flight Rules Validation

```
MCP: firebase_validate_security_rules(type: "firestore", source_file: "firestore.rules")
MCP: firebase_validate_security_rules(type: "storage", source_file: "storage.rules")
MCP: firebase_validate_security_rules(type: "rtdb", source_file: "database.rules.json")
```

> 🔴 Якщо будь-який файл НЕ валідний → **ЗУПИНИТИ ДЕПЛОЙ**

### Крок 2: Security Check

| Перевірка | Команда | Fail condition |
|-----------|---------|----------------|
| Open rules | `Select-String "if true" *.rules` | Знайдено |
| isAdmin() | `Select-String "isAdmin" firestore.rules` | Не знайдено |
| Deny-all fallback | Прочитати кінець кожного rules файлу | Відсутній |

> 🔴 Якщо знайдено `if true` → **НЕГАЙНО ЗУПИНИТИ, повідомити користувача**

### Крок 3: Drift Detection

```
MCP: firebase_get_security_rules(type: "firestore")
→ Порівняти локальний файл з продакшн
→ Показати різницю якщо є
```

### Крок 4: Deploy

```powershell
# Тільки hosting:
npx firebase deploy --only hosting

# Hosting + всі rules:
npx firebase deploy

# Окремо rules:
npx firebase deploy --only firestore:rules
npx firebase deploy --only database
npx firebase deploy --only storage
```

### Крок 5: Post-deploy Verification

```powershell
# Перевірити доступність
Invoke-WebRequest -Uri "https://fight-craft-3c3f0.web.app" -Method Head -UseBasicParsing | Select-Object StatusCode
```

## Конфігурація

| Параметр | Значення |
|----------|---------|
| Project ID | `fight-craft-3c3f0` |
| Live URL | https://fight-craft-3c3f0.web.app |
| Hosting dir | `www/` |
| Config | `firebase.json` + `.firebaserc` |

## Ніколи не деплой якщо

- ❌ `allow read, write: if true` знайдено
- ❌ `isAdmin()` відсутня або зламана
- ❌ Rules validation failed (синтаксична помилка)
- ❌ Є uncommitted changes у rules файлах (без review)

> **Деплой — це production-операція. Завжди перевіряй перед виконанням.**
