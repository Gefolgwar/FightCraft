# 🚀 Директива: Deploy Firebase

> **Мета:** Безпечно деплоїти FightCraft на продакшн.
> **Чому:** Деплой без перевірок може відкрити базу даних або зламати гру.

---

## Передумови

- Користувач явно попросив деплой
- Всі зміни закомічені (або користувач підтвердив hot deploy)

## Процедура

### Крок 1: Pre-Deploy Gate
**Виконати:** `execution/pre-deploy-gate.ps1`

Скрипт перевіряє:
- ✅ Синтаксис всіх rules файлів (Firestore, RTDB, Storage)
- ✅ Відсутність `if true` / `allow write: if true`
- ✅ Наявність `isAdmin()` у Firestore rules
- ✅ Git status — uncommitted changes у rules файлах

> 🔴 **Якщо скрипт повернув FAIL → ЗУПИНИТИ ДЕПЛОЙ. Повідомити користувача.**

### Крок 2: Drift Detection
**Виконати:** `execution/drift-check.ps1`

Порівнює локальні rules з продакшн версією через MCP:
```
firebase_get_security_rules(type: "firestore")
```
Показати різницю користувачу якщо є.

### Крок 3: Підтвердження користувача
Показати підсумок:
- Що деплоїться (hosting / rules / все)
- Які зміни в rules (якщо є)
- Попередження від pre-deploy gate

**СТОП — чекати "OK" від користувача.**

### Крок 4: Deploy
```powershell
# Тільки hosting:
npx firebase deploy --only hosting

# Hosting + rules:
npx firebase deploy

# Окремо rules:
npx firebase deploy --only firestore:rules
npx firebase deploy --only database
npx firebase deploy --only storage
```

### Крок 5: Post-Deploy Verification
```powershell
Invoke-WebRequest -Uri "https://fight-craft-3c3f0.web.app" -Method Head -UseBasicParsing
```
Перевірити StatusCode = 200.

---

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Skill | `.agents/skills/deploy-check/SKILL.md` |
| Скрипт | `.agents/execution/pre-deploy-gate.ps1` |
| Скрипт | `.agents/execution/drift-check.ps1` |
| Скрипт | `.agents/execution/validate-rules.ps1` |
| Config | `firebase.json`, `.firebaserc` |

## При помилці

→ Застосувати протокол `protocols/self-annealing.md`
