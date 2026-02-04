# 🔐 Система Авторизації через Email

## 📋 Огляд

Повноцінна система логіну через електронну пошту з трьома ролями користувачів:

| Роль | Можливості |
|------|------------|
| **Admin** | Все + Debug Mode + Створення/видалення тестових гравців |
| **Moderator** | Все + Перегляд всіх гравців (без редагування) |
| **Player** | Базовий геймплей |

---

## 🎯 Структура Даних

### Firestore: `users/{uid}`
```javascript
{
  email: "user@example.com",
  role: "player", // "admin" | "moderator" | "player"
  displayName: "Username",
  createdAt: Timestamp,
  lastLogin: Timestamp
}
```

### Firestore: `users/{uid}/characters/{charId}`
```javascript
{
  player: { name, level, avatar, ... },
  inventory: [...],
  equipment: {...},
  position: { lat, lng },
  ...
}
```

---

## 📦 Файли для Створення/Зміни

### НОВІ файли:
1. `www/login.html` - Сторінка логіну/реєстрації
2. `www/js/auth.js` - Модуль авторизації
3. `www/css/auth.css` - Стилі для форм

### ЗМІНЕНІ файли:
1. `www/js/firebase-service.js` - Email auth замість anonymous
2. `www/js/app.js` - Перевірка ролей
3. `www/js/ui-controller.js` - Приховування debug для не-admin
4. `www/index.html` - Приховування debug елементів
5. `firestore.rules` - Правила для ролей

---

## 🔧 Етапи Впровадження

### Етап 1: Login/Register UI
- Створити login.html з формами
- Email + Password поля
- Кнопки Login/Register
- Забули пароль

### Етап 2: Firebase Email Auth
- signInWithEmailAndPassword
- createUserWithEmailAndPassword
- sendPasswordResetEmail
- Зберігання ролі при реєстрації

### Етап 3: Ролі Користувачів
- Перевірка ролі при логіні
- Збереження ролі в Firestore
- Адміни задаються вручну в консолі

### Етап 4: Обмеження Debug Mode
- Debug тільки для admin
- Приховати кнопку debug для інших
- Заборонити створення тестових гравців

### Етап 5: Security Rules
- Оновити Firestore rules
- Перевірка ролей

---

## ⏱️ Приблизний Час

| Етап | Час |
|------|-----|
| Login UI | 10 хв |
| Email Auth | 15 хв |
| Ролі | 10 хв |
| Debug обмеження | 10 хв |
| Security Rules | 5 хв |
| Тестування | 10 хв |
| **Всього** | **~60 хв** |

---

## 🚀 Готові Почати?

Підтвердіть і я почну з Етапу 1.
