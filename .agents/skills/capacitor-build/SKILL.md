---
name: capacitor-build
description: "Навик для збірки та оптимізації Android-додатку через Capacitor. Покриває синхронізацію, Gradle конфігурацію, WebView дебаг, підпис APK. Активується при запиті 'збірка Android', 'capacitor sync', або проблемах з android/."
---

# 📱 Capacitor Build & Android

## Динамічний контекст

```powershell
# Capacitor конфігурація
Get-Content "capacitor.config.json"

# Android Gradle (root)
Get-Content "android\build.gradle" -TotalCount 30 -ErrorAction SilentlyContinue

# Android Gradle (app)
Get-Content "android\app\build.gradle" -TotalCount 50 -ErrorAction SilentlyContinue

# Package.json scripts
Select-String -Pattern "android|capacitor|cap " "package.json"

# Поточні залежності
Select-String -Pattern "capacitor" "package.json"
```

## Команди

| Команда | Дія |
|---------|-----|
| `npx cap sync android` | Синхронізація www/ → android/app/src/main/assets/ |
| `npx cap open android` | Відкрити в Android Studio |
| `npm run android:build` | Debug APK |
| `npm run android:release` | Release AAB |
| `npx cap run android` | Запустити на підключеному пристрої |

## Структура Android проекту

```
android/
├── app/
│   ├── build.gradle          # App-level Gradle
│   ├── src/main/
│   │   ├── assets/public/    # ← Копія www/ після cap sync
│   │   ├── java/.../         # MainActivity
│   │   └── AndroidManifest.xml
│   └── capacitor.build.gradle
├── build.gradle              # Root Gradle
├── settings.gradle           # Gradle settings
└── gradle/                   # Gradle wrapper
```

## Типові проблеми

### "Duplicate root element android"
**Причина:** `settings.gradle` містить дублікат `rootProject.name`
**Рішення:** Залишити ОДНУ декларацію `rootProject.name = "android"`

### Gradle sync fails
```powershell
# Очистити Gradle cache
Remove-Item -Recurse -Force "android\.gradle" -ErrorAction SilentlyContinue
# Re-sync
npx cap sync android
```

### WebView debugging (Chrome DevTools)
1. Підключити Android пристрій через USB
2. `chrome://inspect` → знайти WebView
3. Inspect → Console для JavaScript помилок

### Signing Config (release)
```groovy
// android/app/build.gradle
signingConfigs {
    release {
        storeFile file('keystore.jks')
        storePassword System.getenv('KEYSTORE_PASSWORD')
        keyAlias 'release'
        keyPassword System.getenv('KEY_PASSWORD')
    }
}
```

## Capacitor Config

```json
{
  "appId": "com.fightcraft.app",
  "appName": "FightCraft",
  "webDir": "www",
  "server": {
    "androidScheme": "https"
  }
}
```

## Оптимізація для мобільних

- **Safe area insets** — `env(safe-area-inset-top)` для notch
- **Viewport** — `maximum-scale=1, user-scalable=no`
- **Overscroll** — `overscroll-behavior: none`
- **Touch targets** — мінімум 44x44px
- **Не чіпати `.meta` файли** Android Studio

> **Перед будь-якою зміною в `android/` завжди спочатку `npx cap sync android`.**
