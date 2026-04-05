# ⚔️ FightCraft — Geolocation PvP RPG

Мобільна геолокаційна RPG з PvP-боями в реальному часі. Досліджуй реальний світ, борися з монстрами, виклик іншим гравцям на бій та захоплюй території!

**🌐 Live:** [fight-craft-3c3f0.web.app](https://fight-craft-3c3f0.web.app)

---

## ✨ Основні фічі

- 🗺️ **Геолокаційна карта** — Leaflet-based карта з реальними координатами гравця
- ⚔️ **PvE Combat** — Зонова бойова система (голова/тіло/пояс/ноги) проти монстрів
- 🤺 **PvP Combat** — Виклик та бій з іншими гравцями в реальному часі (Firebase RTDB)
- 👥 **Multiplayer** — Бачиш інших гравців на карті, онлайн-список, синхронізація позицій
- 🏰 **Замки та цитаделі** — Захоплення та контроль територій
- 🎒 **Інвентар та спорядження** — Зброя, броня, зілля
- 📊 **Прокачка персонажа** — Рівні, статистика, розподіл очок

---

## 🛠️ Технології

| Компонент | Технологія |
|-----------|-----------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES6+ Modules) |
| **UI Framework** | TailwindCSS |
| **Карта** | Leaflet.js |
| **Backend** | Firebase (Auth, Firestore, RTDB, Storage, Hosting) |
| **PvP Sync** | Firebase Realtime Database |
| **Mobile** | Capacitor.js (Android) |
| **Оптимізація** | Static Bundles + IndexedDB SyncEngine |

---

## 📁 Структура проєкту

```
FightCraft/
├── firebase.json            ← Firebase конфігурація
├── package.json             ← Залежності
├── firestore.rules          ← Правила безпеки Firestore
├── database.rules.json      ← Правила безпеки RTDB
├── storage.rules            ← Правила безпеки Storage
├── capacitor.config.json    ← Capacitor конфігурація
├── www/                     ← 🌐 Web-додаток (Firebase Hosting)
│   ├── index.html           ← Головна сторінка
│   ├── login.html           ← Сторінка авторизації
│   ├── admin.html           ← Адмін-панель
│   ├── css/style.css        ← Стилі
│   └── js/
│       ├── app.js               ← Точка входу + ініціалізація
│       ├── ui-controller.js     ← Управління UI (панелі, модалки)
│       ├── map.js               ← Leaflet карта + маркери гравців
│       ├── firebase-service.js  ← Firebase Auth/Firestore/RTDB
│       ├── combat.js            ← PvE бойова система
│       ├── pvp.js               ← PvP бойова система
│       ├── gameState.js         ← Стан гри
│       ├── data.js              ← Бази предметів та монстрів
│       ├── districts.js         ← Система районів
│       ├── poi.js               ← Точки інтересу
│       ├── monsters.js          ← Генерація монстрів
│       ├── sync-engine.js       ← Оптимізація завантаження
│       └── character-selection.js ← Вибір персонажа
├── android/                 ← Android-збірка (Capacitor)
└── DEV-QUICK-REFERENCE.md   ← Довідка для розробника
```

---

## 🚦 Quick Start

```bash
# 1. Встановити залежності
npm install

# 2. Запустити локально (Firebase Hosting Emulator)
npx firebase serve --only hosting --port 5000

# 3. Відкрити у браузері
# http://localhost:5000

# 4. Деплой на продакшн
npx firebase deploy --only hosting
```

---

## 🎮 Геймплей

### Бойова система
Зонова система бою з 4 зонами атаки/захисту:
- 🎯 **Голова** — високий урон, важко влучити
- 💪 **Тіло** — збалансована зона
- 🔗 **Пояс** — швидкі атаки
- 🦵 **Ноги** — зниження мобільності

### PvP
- Виклик гравцю через кнопку на панелі онлайн-гравців або натискання на маркер
- Бій в реальному часі через Firebase RTDB
- Результати: **Перемога / Поразка / Нічия**
- Статистика PvP зберігається в профілі

### Оптимізація Firestore
- **99.6% зменшення читань** при ініціалізації (з 2600+ до ~15)
- Static Bundles стратегія з IndexedDB кешуванням

---

## 📱 Mobile Build (Android)

```bash
# Синхронізація з Capacitor
npx cap sync android

# Збірка в Android Studio
npx cap open android
```

---

## 🔐 Firebase Security

Правила безпеки налаштовані у файлах:
- `firestore.rules` — контроль доступу до Firestore
- `database.rules.json` — контроль доступу до RTDB
- `storage.rules` — контроль доступу до Storage

---

*Версія: v0.5.0 | Останнє оновлення: 2026-04-05*
