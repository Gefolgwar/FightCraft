# 🔐 Оновлення Firebase Security Rules

## ❌ Проблема

```
FirebaseError: Missing or insufficient permissions.
```

**Причина:** Нова структура даних використовує `users/{userId}/characters/{characterId}`, але правила доступу не дозволяють запис у subcollections.

---

## ✅ Рішення

Потрібно оновити Firebase Security Rules. Є **2 способи**:

---

## 🚀 Спосіб 1: Через Firebase Console (НАЙШВИДШЕ)

### Крок 1: Відкрийте Firebase Console
```
https://console.firebase.google.com/project/fight-craft-3c3f0/firestore/rules
```

### Крок 2: Замініть ВЕСЬ вміст на:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // OLD STRUCTURE (Read Only for compatibility)
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // NEW STRUCTURE - CHARACTERS SUBCOLLECTION
    match /users/{userId}/characters/{characterId} {
      // Users can manage their own characters
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Крок 3: Натисніть "Publish" (вгорі праворуч)

### Крок 4: Перезавантажте гру
```
F5 в браузері
```

**Готово!** Має запрацювати.

---

## 🖥️ Спосіб 2: Через Firebase CLI

**Якщо маєте Firebase CLI встановлений:**

### Крок 1: Запустіть скрипт
```powershell
.\deploy-rules.ps1
```

**АБО вручну:**

### Крок 1: Перевірте що Firebase CLI встановлено
```powershell
firebase --version
```

**Якщо НЕ встановлено:**
```powershell
npm install -g firebase-tools
```

### Крок 2: Увійдіть в Firebase
```powershell
firebase login
```

### Крок 3: Оберіть проект
```powershell
firebase use fight-craft-3c3f0
```

### Крок 4: Deploy правил
```powershell
firebase deploy --only firestore:rules
```

**Готово!**

---

## 🧪 Перевірка

Після оновлення правил:

**1. Refresh гри:**
```
F5
```

**2. Спробуйте створити персонажа**

**Очікується:**
- ✅ Персонаж створюється без помилок
- ✅ З'являється в Character Selection
- ✅ Гра запускається

**3. Перевірте консоль:**
```javascript
// Не має бути помилок "Missing or insufficient permissions"
```

---

## 📋 Що Роблять Нові Правила?

### Дозволено:
- ✅ Читати **свої** персонажі
- ✅ Створювати **свої** персонажі
- ✅ Оновлювати **свої** персонажі
- ✅ Видаляти **свої** персонажі
- ✅ Читати інформацію інших гравців (для multiplayer)

### Заборонено:
- ❌ Змінювати чужих персонажів
- ❌ Видаляти чужих персонажів
- ❌ Доступ без автентифікації

---

## 🔍 Діагностика

### Якщо після оновлення правил все ще помилка:

**1. Перевірте що правила застосувались:**
- Відкрийте: https://console.firebase.google.com/project/fight-craft-3c3f0/firestore/rules
- Має бути оновлена версія з `characters/{characterId}`

**2. Перевірте що ви авторизовані:**
```javascript
import { getCurrentUser } from './js/firebase-service.js';
console.log(getCurrentUser());
// Має показати user object з uid
```

**3. Hard refresh:**
```
Ctrl + Shift + R
```

**4. Очистіть кеш:**
```
Ctrl + Shift + Del → Clear cache
```

---

## 🎯 Швидке Рішення (1 клік)

**Якщо швидко потрібно виправити:**

1. Відкрити: https://console.firebase.google.com/project/fight-craft-3c3f0/firestore/rules
2. Скопіювати з файлу `firestore.rules`
3. Вставити в консоль
4. Publish
5. F5 в грі

**Час: ~30 секунд** ⏱️

---

## ✅ Після Виправлення

Система має працювати:
- ✅ Character Selection показується
- ✅ Можна створювати персонажів
- ✅ Персонажі зберігаються в Firebase
- ✅ Multiplayer Panel працює
- ✅ Дані синхронізуються

**Готово до гри!** 🎮

---

**Примітка:** Якщо використовуєтеTest Mode, правила можуть скинутись через 30 днів. Використовуйте Production rules як вище.
