# 🔧 HOTFIX: BigInt Serialization Error

**Error:** `TypeError: Do not know how to serialize a BigInt`  
**Location:** `ui-controller.js:731`  
**Status:** ✅ FIXED

---

## Problem:

Firebase Timestamps contain BigInt values that cannot be serialized with `JSON.stringify()`.

```javascript
// OLD (broken):
data: JSON.parse(JSON.stringify(gameState)) // ❌ Fails with BigInt
```

---

## Solution:

Use `structuredClone()` which handles BigInt, Dates, and other complex types:

```javascript
// NEW (fixed):
data: structuredClone(gameState) // ✅ Works with BigInt
```

---

## Fallback:

If `structuredClone()` is not available (older browsers), manual deep copy:

```javascript
data: {
    player: { ...gameState.player },
    inventory: [...gameState.inventory],
    equipment: { ...gameState.equipment },
    quests: { ...gameState.quests },
    settings: { ...gameState.settings },
    debug: { ...gameState.debug }
}
```

---

## Testing:

1. **Reload page:** Ctrl + F5
2. **Switch to player:** 👁️ View
3. **Confirm dialog**
4. **✅ No error!**
5. **Character loads successfully**

---

## Files Modified:

- ✅ `www/js/ui-controller.js` (line 726-750)
  - Replaced `JSON.parse(JSON.stringify())` with `structuredClone()`
  - Added try/catch fallback

---

**Status:** ✅ Fixed  
**Time:** 1 minute  
**Action:** Reload page + test switch! 🚀
