# ✨ Директива: New Feature (ACR Cycle)

> **Мета:** Безпечно додати нову фічу або систему в FightCraft.
> **Чому:** Без ACR циклу зміни ламають Firebase rules, клієнтський код, або створюють дірки в безпеці.

---

## Передумови

- Тригер: будь-яка нова фіча, нова система, великі архітектурні зміни
- Правило ACR: `.agents/rules/a-c-r.md` (always-on)

## Процедура

### Фаза 1: 📐 Architect (Аналіз)

**Створити технічне рішення що включає:**

1. **Firebase Rules зміни** — нові колекції/вузли, правила доступу
   - Firestore: `firebase/firestore.rules`
   - RTDB: `firebase/database.rules.json`
   - Storage: `firebase/storage.rules`

2. **Клієнтський JS** — нові/змінені файли в `www/`
   - Слідувати структурі: `core/`, `gameplay/`, `map/`, `firebase/`, `auth-ui/`, `maintenance/`

3. **Файлова структура** — які файли створити/змінити

4. **Логіка** — опис для Combat/GPS/синхронізації

> 🛑 **СТОП.** Чекати "OK" від користувача перед кодуванням.

### Фаза 2: 💻 Coder (Імплементація)

**Правила кодування:**
- Vanilla JS (ES6 modules), БЕЗ бандлера
- `window.*` globals через `bridge.js` для `onclick` handlers
- BigInt для XP (`gameState.player.xp`)
- Firebase Rules = єдиний сервер (валідація ТІЛЬКИ в rules)
- DRY, SOLID, коментарі українською
- IndexedDB кеш через SyncEngine

### Фаза 3: 🔍 Reviewer Swarm (Паралельний Review)

Три спеціалізації одночасно:

| Ревьюер | Перевіряє |
|---------|-----------|
| 🔒 Security | Firebase Rules вразливості, GPS coordinate validation, ownership checks |
| 🧠 Logic | Відповідність client JS ↔ server rules, обробка мережевих помилок |
| ⚡ Performance | Оптимізація для мобільних (Capacitor WebView), Firebase cost |

**Після review:** агрегувати знахідки, виправити критичні, повідомити користувача.

Деталі: `protocols/parallel-review.md`

---

## Шаблон плану Architect'а

```markdown
## [Назва фічі]

### Firebase Changes
- Firestore collection: `...`
- RTDB node: `...`
- Rules: `...`

### Client Files
- [NEW/MODIFY] `www/.../file.js` — опис

### Logic
- ...

### Edge Cases
- Disconnect handling
- Race conditions
- Validation in rules
```

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Rule | `.agents/rules/a-c-r.md` |
| Protocol | `.agents/protocols/parallel-review.md` |
