# 📋 Реєстр директив

> **Цей файл — маршрутна таблиця.** Агент перевіряє його ПЕРШИМ при кожній команді.

## Як користуватися

1. Знайди інтент користувача в таблиці нижче
2. Відкрий відповідний файл директиви
3. Виконай директиву крок за кроком
4. Якщо відповідної директиви НЕМАЄ → див. `add-execution-script.md`

---

## Таблиця маршрутизації

| Інтент / Ключові слова | Директива | Skill (якщо є) |
|------------------------|-----------|-----------------|
| "деплой", "deploy", "випустити на продакшн" | [deploy-firebase.md](deploy-firebase.md) | `skills/deploy-check/` |
| "безпека", "security audit", "аудит rules" | [security-audit.md](security-audit.md) | `skills/security-audit/` |
| "баланс", "balance", зміни в `data.js` | [game-balance-audit.md](game-balance-audit.md) | `skills/game-balance/` |
| "збірка Android", "capacitor", "APK", "AAB" | [capacitor-build.md](capacitor-build.md) | `skills/capacitor-build/` |
| "мультиплеєр", "sync", "PvP", "RTDB health" | [multiplayer-sync-check.md](multiplayer-sync-check.md) | `skills/multiplayer-sync/` |
| нова фіча, нова система, великі зміни | [new-feature.md](new-feature.md) | — (ACR цикл) |
| "хотфікс", "терміново", критичний баг | [hotfix.md](hotfix.md) | — |
| потрібен новий інструмент/скрипт | [add-execution-script.md](add-execution-script.md) | — |

---

## Fallback

Якщо жоден рядок не підходить:
1. Задача **проста** (виправити typo, додати коментар) → виконати напряму
2. Задача **складна** → створити нову директиву через `add-execution-script.md`
3. **Невпевнений** → запитати користувача: "Яку директиву застосувати?"
