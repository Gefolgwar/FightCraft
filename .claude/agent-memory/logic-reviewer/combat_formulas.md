---
name: Combat Formula Patterns
description: FightCraft damage formulas, stat derivation, and known logic gaps in PvE/PvP/Group combat
type: project
---

Three separate damage calculation paths exist, each with different mechanics:

1. **PvE Solo** (`combat.js:657`): `max(1, derivedDamage - defense)`, crit *2. Hit chance rolled but defense zones NOT checked.
2. **PvP** (`battle-logic.js:128`): Same base formula but zone blocking applied (50% reduction). Hit chance computed but NEVER rolled — PvP always hits.
3. **Group/Unified** (`combat.js:470`): Hardcoded `random(10)+15` damage — ignores all player stats.

**Why:** These three paths evolved separately during MVP development and were never unified.
**How to apply:** Any combat rebalancing must update all three paths. The PvP formula is the most complete; PvE should adopt zone blocking from it.

Key stat formulas (`gameState.js:78-151`):
- derivedDamage = 5 + strength*2 + equipment.attackBonus
- maxHp = 100 + vitality*10
- hitChance = 80 + agility*0.5 (NOT used in PvP)
- critChance = intuition*0.5
- dodgeChance = agility*0.5
- XP curve: 500 * level^2

Monster affixes (AFFIXES in data.js) are defined but NEVER applied in calculateDamage(). The affix system is cosmetic only.
