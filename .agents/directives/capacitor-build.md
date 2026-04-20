# 📱 Директива: Capacitor Build (Android)

> **Мета:** Зібрати та оптимізувати Android-додаток через Capacitor.
> **Чому:** Неправильна синхронізація www/ → android/ ламає мобільний додаток.

---

## Передумови

- Тригер: "збірка Android", "capacitor sync", "APK", проблеми з `android/`
- `node_modules/` встановлені (`npm install`)
- Capacitor config актуальний (`capacitor.config.json`)

## Процедура

### Крок 1: Активувати Skill
**Прочитати:** `.agents/skills/capacitor-build/SKILL.md`

Skill містить:
- Повну структуру Android проекту
- Типові проблеми (duplicate root, Gradle sync fails)
- Signing config для release
- Оптимізацію для мобільних

### Крок 2: Перевірити конфігурацію
```powershell
Get-Content "capacitor.config.json"
Get-Content "android\app\build.gradle" -TotalCount 50 -ErrorAction SilentlyContinue
```

### Крок 3: Синхронізація
```powershell
npx cap sync android
```

### Крок 4: Build
```powershell
# Debug APK:
npm run android:build

# Release AAB:
npm run android:release
```

### Крок 5: Verify
- Перевірити що `android/app/src/main/assets/public/` містить актуальний www/
- Перевірити що Gradle sync пройшов успішно

---

## Правила

- ⚠️ **НЕ чіпати `.meta` файли** (Android Studio metadata)
- ⚠️ **Завжди `npx cap sync android` ПЕРЕД змінами в `android/`**
- Signing credentials → `.agents/env/.env` (НІКОЛИ не хардкодити)

## Пов'язані ресурси

| Тип | Шлях |
|-----|------|
| Skill | `.agents/skills/capacitor-build/SKILL.md` |
| Config | `capacitor.config.json` |
| Android | `android/app/build.gradle` |

## При помилці

→ Застосувати протокол `protocols/self-annealing.md`
