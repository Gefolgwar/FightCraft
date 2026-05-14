# Session Report: Seed-Based Snapshot Architecture Refactor

**Дата:** 2026-05-12  
**Файл:** `www/map/templates_map.html`  
**Тип:** Архітектурний рефакторинг  
**Статус:** ✅ Завершено

---

## Контекст

Сторінка `templates_map.html` — адмін-інтерфейс для генерації та управління world snapshots. Основний flow:

1. Адмін натискає **"Render Global Map"** → генеруються цитаделі для всіх міст світу
2. Адмін натискає **"Generate Zones"** → генеруються Voronoi-зони, обрізані по контурах суші
3. Після `Ctrl+F5` (перезавантаження) адмін обирає snapshot з sidebar → бачить ті ж самі цитаделі та зони

## Проблема (до рефакторингу)

### 1. Зайві записи в Firebase
- `previewGlobalWorld()` зберігала 14 полів у `world_snapshots/{id}` (seed, totalObjects, zoneConfig, isActive, chunked, type...)
- `generateSnapshotZones()` зберігала зони як zone_chunks у subcollection `world_snapshots/{id}/zone_chunks/` (потенційно мегабайти даних)
- Metadata оновлювалась при кожній генерації зон

### 2. Дублювання кнопки "Generate Zones"
Кнопка інжектувалась у **3 місцях** через `innerHTML +=`:
- `previewGlobalWorld()` — після генерації цитаделей
- `selectSnapshot()` seed branch — після виклику previewGlobalWorld + додатково
- `selectSnapshot()` legacy branch — для chunked-снепшотів

Результат: при виборі seed-based snapshot з sidebar з'являлись **2 кнопки**.

### 3. Дублювання коду статистики
HTML-шаблон панелі деталей (~250 рядків: counts, levels, zone distribution) існував inline у `selectSnapshot()`, а `previewGlobalWorld()` показувала лише спрощений текст "Read-only preview" без повної статистики.

### 4. Зайва складність seed-branch
`selectSnapshot()` для seed-based снепшотів мала ~110 рядків логіки: повторне заповнення `_lastCitadelsByCity`, спроба завантаження zone_chunks з Firebase, fallback на Voronoi preview, інжекція кнопки — все це вже робилось у `previewGlobalWorld()`.

## Рішення (після рефакторингу)

### Ключовий принцип: детерміністична генерація з seed

`SeededRandom` (`www/core/random.js`) — це PRNG на основі SplitMix/Mulberry32. Той самий seed завжди дає:
- ті самі координати цитаделей
- той самий Voronoi diagram  
- той самий land-clip (бо `world-atlas@2` з CDN фіксований)

Тому **зберігати потрібно лише seed** — все інше регенерується.

### Зроблені зміни

#### 1. Нова функція `renderDetailsPanel(snap)` (L1450-1718)

Витягнув обчислення статистики та HTML-шаблон з `selectSnapshot()` в окрему функцію:
- Обчислює counts (monster, shop, vault, castle, citadel), levels (min/max/avg), zone distribution
- Рендерить повну панель деталей: Snap ID, City, Type, Date, Population Stats, Seed, Challenge Level, Zone Distribution tabs
- Вставляє **ОДНУ** кнопку "Generate Zones"

#### 2. Спрощений Firebase save в `previewGlobalWorld()`

Було (14 полів):
```javascript
{
    name, cityId, type, seed, totalObjects,
    zoneConfig: { generated: false },
    isActive, chunked, createdAt, createdBy
}
```

Стало (5 полів):
```javascript
{
    seed, name, cityId, createdAt, createdBy
}
```

Після збереження функція викликає `renderDetailsPanel(currentSnapshot)` для показу повної статистики + легкий Voronoi preview.

#### 3. Спрощений seed-branch в `selectSnapshot()`

Було (~110 рядків):
```
- previewGlobalWorld(snap.seed)
- повторне заповнення _lastCitadelsByCity
- loadZoneChunks з Firebase
- fallback на Voronoi preview
- інжекція кнопки "Generate/Regenerate Zones"
```

Стало (4 рядки):
```javascript
if (snap.seed && !snap.chunked) {
    logConsole(`🌱 Regenerating from seed <b>${snap.seed}</b>...`);
    await previewGlobalWorld(snap.seed);
    return;
}
```

#### 4. Legacy branch використовує `renderDetailsPanel(snap)`

Замість ~250 рядків inline статистики — один виклик `renderDetailsPanel(snap)`. Дублювання кнопки "Generate Zones" видалено.

#### 5. `generateSnapshotZones()` без Firebase saves

- Видалено параметр `skipSave`
- Видалено `saveZoneChunks()` — зони живуть тільки в пам'яті
- Видалено оновлення metadata в Firestore
- Залишено тільки `currentSnapshot.zoneConfig = { generated: true, algorithm: "voronoi_clipped", totalFeatures }` в пам'яті

## Метрики

| Метрика | До | Після |
|---------|-----|-------|
| Розмір файлу | 3566 рядків | 3397 рядків (−169) |
| Кнопки "Generate Zones" | 3 місця інжекції | **1** (в `renderDetailsPanel`) |
| Firebase writes (Render Global) | 1 doc (14 полів) | 1 doc (**5 полів**) |
| Firebase writes (Generate Zones) | N chunk docs + 1 meta update | **0** |
| Firebase reads (select seed snapshot) | 1 meta + N zone_chunks | **0** (з seed) |
| Дублювання коду stats | 2 копії (~250 рядків) | **1** функція |
| Firestore cost per snapshot | ~5-50 reads + ~5-50 writes | **2 operations** (1 write, 1 read) |
| Дані у Firestore per snapshot | ~1-5 MB (zone chunks) | **~200 bytes** (seed) |

## Новий Data Flow

```
1. "Render Global Map"
   ├── SeededRandom(seed) → детерміновані цитаделі
   ├── Рендер маркерів на Leaflet map
   ├── currentSnapshot + _lastCitadelsByCity в пам'яті
   ├── Firebase save: ТІЛЬКИ {seed, name, cityId, createdAt, createdBy}
   ├── renderDetailsPanel() → повна статистика + 1 кнопка "Generate Zones"
   └── Lightweight Voronoi preview

2. "Generate Zones"
   ├── loadLandMask() ← CDN (кешується)
   ├── Filter citadels → тільки на суші
   ├── Voronoi → clip до суші
   ├── processAndRenderZones() → рендер на карту
   └── currentSnapshot.zoneConfig = { generated: true } ← тільки пам'ять

3. Ctrl+F5 → Select snapshot from sidebar
   ├── selectSnapshot(snap) → snap.seed exists
   ├── previewGlobalWorld(snap.seed) → ті ж цитаделі (детерміновано)
   ├── renderDetailsPanel() → статистика + кнопка
   └── Voronoi preview → ті ж зони (детерміновано)
```

## Що зберігається в Firebase

```
Collection: world_snapshots/global_world_{seed}
{
  seed: number,          // ← ВСЕ. Решта генерується з нього.
  name: string,
  cityId: "global",
  createdAt: Timestamp,
  createdBy: string
}
// Немає subcollections chunks/ або zone_chunks/
```

## Нюанси та ризики

1. **Детермінованість залежить від CDN**: land mask завантажується з `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json`. Версія зафіксована (`@2`), дані стабільні. Для гарантії можна кешувати локально.

2. **Legacy snapshots**: Старі chunked-снепшоти (без seed) продовжують працювати через legacy branch в `selectSnapshot()`. `loadZoneChunks` залишається для них.

3. **Toggle/Delete для seed-snapshots**: Seed-branch робить early return перед ініціалізацією toggle/delete кнопок. Це було і раніше — не регресія.

## Файли змінені

- `www/map/templates_map.html` — основні зміни (−169 рядків)

## Файли НЕ змінені

- `www/firebase/snapshot-service.js` — `saveZoneChunks`/`loadZoneChunks` залишаються для legacy
- `www/core/random.js` — SeededRandom без змін
- `www/gameplay/world_cities.js` — дані міст без змін
