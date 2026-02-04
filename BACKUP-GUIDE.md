# 💾 Firebase Backup & Restore Guide

## 🎯 Швидкий Backup (Рекомендовано)

### Крок 1: Відкрийте гру
```
http://localhost:8080
```

### Крок 2: Відкрийте консоль (F12)

### Крок 3: Завантажте скрипт
```javascript
const script = document.createElement('script');
script.type = 'module';
script.src = './backup-firestore.js';
document.head.appendChild(script);
```

### Крок 4: Зачекайте
Скрипт автоматично:
1. З'єднається з Firestore
2. Завантажить всі дані
3. Створить JSON файл
4. Завантажить його у папку **Downloads**

**Назва файлу:** `firestore-backup-2026-01-28.json`

---

## 🔄 Відновлення з Backup

### Якщо щось пішло не так:

**Крок 1:** Завантажте скрипт відновлення:
```javascript
const script = document.createElement('script');
script.type = 'module';
script.src = './restore-firestore.js';
document.head.appendChild(script);
```

**Крок 2:** Запустіть відновлення:
```javascript
uploadAndRestore()
```

**Крок 3:** Виберіть backup файл з Downloads

**Крок 4:** Підтвердіть відновлення

---

## 📋 Альтернатива: Через Firebase Console

### Export (Backup):
1. https://console.firebase.google.com/project/fight-craft-3c3f0/firestore
2. Три крапки (⋮) → **Export data**
3. Collection: `users` → **Export**

### Import (Restore):
1. Три крапки (⋮) → **Import data**
2. Виберіть раніше експортований файл

**Примітка:** Це зберігає backup в Google Cloud Storage (може бути платним для великих даних).

---

## 🧪 Що зберігається у backup?

```json
{
  "exportDate": "2026-01-28T10:57:00.000Z",
  "collection": "users",
  "documents": [
    {
      "id": "ABC123...",
      "data": {
        "player": {
          "name": "TestPlayer706",
          "level": 4,
          "gold": 150,
          ...
        },
        "inventory": [...],
        "equipment": {...},
        "position": { "lat": 52.4845, "lng": 13.4499 },
        ...
      }
    }
  ]
}
```

---

## ⚠️ Важливо!

1. **Backup перед рефакторингом** - Старі дані можуть бути несумісні після змін
2. **Зберігайте backup файл** у безпечному місці
3. **Перевірте backup** - Відкрийте JSON файл, переконайтеся що дані там є

---

## 🎯 Коли робити backup?

✅ **ЗАРАЗ** - Перед впровадженням Character Selection
✅ Перед великими змінами в коді
✅ Перед deploy на production
✅ Періодично (раз на тиждень)

---

## 📊 Швидка діагностика backup

Після створення backup, перевірте у консолі:

```javascript
// Завантажте backup файл
const input = document.createElement('input');
input.type = 'file';
input.accept = '.json';
input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
        const backup = JSON.parse(event.target.result);
        console.log('📊 Backup Statistics:');
        console.log(`   Documents: ${backup.documents.length}`);
        console.log(`   Export date: ${backup.exportDate}`);
        console.table(backup.documents.map(d => ({
            Name: d.data.player?.name,
            Level: d.data.player?.level,
            Gold: d.data.player?.gold
        })));
    };
    reader.readAsText(file);
};
input.click();
```

---

**Готові створити backup?**

1. Відкрийте http://localhost:8080
2. Натисніть F12
3. Скопіюйте команду вище
4. Зачекайте завантаження файлу
5. ✅ Готово!
