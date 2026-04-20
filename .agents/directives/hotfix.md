# 🚑 Директива: Hotfix

> **Мета:** Швидко виправити критичний баг на продакшні.
> **Чому:** Продакшн зламаний — гравці не можуть грати. Швидкість > формальність.

---

## Передумови

- Тригер: "хотфікс", "терміново", критичний баг на продакшні
- Тільки для КРИТИЧНИХ помилок (гра не запускається, дані втрачаються, security hole)
- Для некритичних багів → використовуй `new-feature.md` (повний ACR цикл)

## Процедура

### Крок 1: Діагностика (1 хвилина)

1. Визначити тип помилки:
   - **JS crash** → подивитися browser console / DevTools
   - **Firebase error** → перевірити rules + MCP
   - **Data corruption** → перевірити Firestore/RTDB через MCP

2. Знайти файл проблеми (grep / MCP / log)

### Крок 2: Мінімальний фікс

- Виправити ТІЛЬКИ баг, НІЧОГО більше
- Якщо фікс стосується Firebase Rules:
  ```
  execution/validate-rules.ps1  ← перевірити синтаксис
  ```
- Якщо фікс стосується клієнтського JS:
  - Перевірити `bridge.js` exports
  - Перевірити BigInt сумісність (XP)

### Крок 3: Quick Review

Замість повного Reviewer Swarm — одна швидка перевірка:
- ✅ Firebase Rules валідні (MCP validate)
- ✅ Немає `if true`
- ✅ Баг відтворений → виправлений → не відтворюється

### Крок 4: Deploy

```powershell
# Тільки те що змінилося:
npx firebase deploy --only hosting        # якщо JS fix
npx firebase deploy --only firestore:rules # якщо rules fix
```

### Крок 5: Verify на продакшні
Перевірити https://fight-craft-3c3f0.web.app

---

## ⚠️ Після хотфіксу

1. Створити нормальний тікет / план для root cause
2. Додати тест-кейс щоб баг не повторився
3. Повний review через `protocols/parallel-review.md`

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Скрипт | `.agents/execution/validate-rules.ps1` |
| Директива | `deploy-firebase.md` (для деплою) |
