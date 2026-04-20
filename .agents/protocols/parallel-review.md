# 🔍 Протокол: Parallel Review (4-фазний цикл)

> **Мета:** Забезпечити якість коду через паралельний review трьома спеціалістами.
> **Коли:** Після завершення кодування будь-якої фічі (Фаза 2 ACR циклу).

---

## Фази

```
Фаза 1: 📐 Architect    → Створює план           → СТОП (чекати OK)
Фаза 2: 💻 Coder         → Пише код за планом     → Готово до review
Фаза 3: 🔍 Review × 3   → Паралельний аналіз     → Звіт
Фаза 4: 📊 Aggregation   → Об'єднання знахідок    → Фінальний вердикт
```

---

## Фаза 3: Паралельний Review (деталі)

Три ревьюери працюють **одночасно** над тим самим кодом:

### 🔒 Security Expert
**Чекліст:**
- [ ] Firebase Rules покривають нові endpoints
- [ ] `.write` має ownership check (не просто `auth != null`)
- [ ] GPS координати валідуються (lat ∈ [-90, 90], lng ∈ [-180, 180])
- [ ] Немає hardcoded UIDs
- [ ] Sensitive data не в клієнтському коді
- [ ] XSS: user input sanitized

**Інструменти:**
```
execution/validate-rules.ps1
MCP: firebase_validate_security_rules
Skill: skills/security-audit/SKILL.md
```

### 🧠 Logic Expert
**Чекліст:**
- [ ] Client JS відповідає Firebase Rules (те що rules дозволяють — клієнт використовує)
- [ ] Network errors обробляються (try/catch, offline fallback)
- [ ] Race conditions: update() замість set() для shared data
- [ ] onDisconnect встановлений для ephemeral RTDB data
- [ ] BigInt XP — арифметика правильна
- [ ] bridge.js — нові window.* globals зареєстровані

**Інструменти:**
```
Skill: skills/multiplayer-sync/SKILL.md (патерни проблем)
```

### ⚡ Performance/Style Expert
**Чекліст:**
- [ ] Мобільна оптимізація (touch targets ≥ 44px, overscroll: none)
- [ ] Firebase reads мінімізовані (SyncEngine IndexedDB кеш)
- [ ] Listener cleanup (unsubscribe зберігається)
- [ ] Немає memory leaks (intervals, timeouts, event listeners)
- [ ] Код чистий: DRY, SOLID, коментарі українською
- [ ] Z-index відповідає конвенції (1000/2000/3000/4000/5000)

**Інструменти:**
```
Skill: skills/game-balance/SKILL.md (для gameplay змін)
```

---

## Фаза 4: Aggregation

### Формат звіту
```markdown
## Review Report — [назва фічі] — [дата]

### 🔒 Security
- [🔴/🟡/🟢] Знахідка 1
- [🔴/🟡/🟢] Знахідка 2

### 🧠 Logic  
- [🔴/🟡/🟢] Знахідка 1

### ⚡ Performance
- [🔴/🟡/🟢] Знахідка 1

### Вердикт
- 🟢 APPROVE — код готовий до деплою
- 🟡 APPROVE WITH CHANGES — виправити warnings перед деплоєм
- 🔴 REQUEST CHANGES — є blockers, потрібен re-review
```

### Правила агрегації
- Якщо хоча б один 🔴 → **REQUEST CHANGES**
- Якщо тільки 🟡 → **APPROVE WITH CHANGES** (виправити перед деплоєм)
- Якщо тільки 🟢 → **APPROVE**
