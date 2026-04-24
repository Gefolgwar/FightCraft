# FightCraft Gameplay Scenarios

This document maps out the user journey through the core game systems of FightCraft, referencing the specific modules, functions, and HTML IDs that drive the gameplay.

## Scenario 1: The Lone Hunter (PvE Combat)

### Context & Pre-conditions
- **State**: The player's GPS coordinates are acquired and synced. `gameState.player.hp` is full.
- **World**: A "Wolf" (Normal class) marker generated from `spawned_objects` in Firestore is visible on the Leaflet map.

### Step-by-Step Flow
1. **Encounter**: The player taps the Wolf marker on the map.
2. **Pre-Combat**: A dialog appears showing the monster's level, HP, and damage.
3. **Engagement**: The player clicks "Fight!", transitioning the game from the map view to the combat arena.
4. **Tactical Selection**: The player selects an attack zone (e.g., Head) and a defense combo (e.g., Body+Belt).
5. **Resolution**: The player presses "Attack", triggering the round calculation.
6. **Victory**: The monster's HP reaches 0. The player receives XP, gold, and potential loot.

### UI/Screen Breakdown
- **Map View**: `<div id="map"></div>`
- **Pre-Combat Dialog**: `<div id="poi-dialog">` overlay containing the monster's stats.
- **Combat Screen**: `<div id="combat-screen">` takes over the viewport.
- **Zone Buttons**: The player clicks buttons with the `.enemy-zone` class (e.g., `data-zone="head"`) and defense buttons with the `.defense-btn` class.
- **Victory Screen**: `<div id="victory-screen">` appears, populating `<span id="reward-xp">`, `<span id="reward-gold">`, and `<div id="reward-items">`.

### Underlying Logic
- **`showPreCombatDialog(monster)`**: Invoked upon clicking the map marker (`combat.js`).
- **`startCombat(monster)`**: Sets up the `gameState.combat` singleton and prepares the arena.
- **`selectAttackZone(zone)` / `selectDefense(defense)`**: Updates selected zones and calls `checkCanAttack()` to enable the Attack button.
- **`executeAttack()`**: Calls pure math functions from `battle-logic.js` (like `calculateDamage`) to evaluate hit/miss, crits, and damage reduction.
- **`victory()`**: 
  - Triggers `window.addXP(m.xpReward)`, which handles BigInt conversions since `gameState.player.xp` is a BigInt.
  - Updates `gameState.player.gold`.
  - Calls `setMonsterInactive(m.id, DEFEATED_COOLDOWN_MS)` writing `defeatedAt` to Firestore's `spawned_objects` so the cooldown applies globally to all players.

---

## Scenario 2: The Challenger (PvP Real-Time)

### Context & Pre-conditions
- **State**: Both players are online, their coordinates synced to the RTDB `live_players` node.

### Step-by-Step Flow
1. **Target Acquisition**: The player opens the Online Players panel and taps a nearby player.
2. **Challenge**: The player selects "Challenge" from the interaction menu.
3. **Handshake**: A real-time challenge prompt appears on the target's screen.
4. **Arena Setup**: The target accepts. A 50m arena boundary is drawn.
5. **Real-Time Combat**: Both players submit their attack/defense choices simultaneously.
6. **Round Sync**: Once both choices are in, the round resolves and HP is updated on both clients.

### UI/Screen Breakdown
- **Online List**: Opened via `<button id="online-players-btn">`, showing `<div id="online-players-panel">`.
- **Interaction Menu**: Opened by clicking a player, providing the "Challenge" action.
- **Combat Screen**: `<div id="combat-screen">`.
- **Boundary Warning**: If a player physically walks outside the 50m radius, an auto-defeat warning triggers.

### Underlying Logic
- **`showPlayerInteractionMenu(...)`**: Renders the context menu (`pvp.js`).
- **`battle_requests/{battleId}` (RTDB)**: The challenge creates a handshake node. The target's `handleBattleRequest` listener catches it.
- **`battles/{battleId}` (RTDB)**: Upon acceptance, the state moves here. Both players use `onBattleAction(action)` to push their `attack`, `defense`, and `ready` states.
- **`checkArenaBoundary(lat, lng)`**: Monitors physical GPS movement during the fight. Exiting the zone triggers `arenaDefeat()`.

---

## Scenario 3: The Warlord (Citadels & Districts)

### Context & Pre-conditions
- **State**: The player physically walks into a new city district.
- **World**: The district polygon (from `districts.js`) encompasses the player's GPS coordinates.

### Step-by-Step Flow
1. **District Entry**: The HUD updates to show the new district name and current King.
2. **Approach Citadel**: The player approaches the central Citadel POI.
3. **Capture**: The player clicks the Citadel button and initiates a Boss fight or claims an empty throne.
4. **Tax Collection**: The player becomes the King. Passive income begins accumulating based on time held.

### UI/Screen Breakdown
- **District HUD**: `<div id="district-hud">` fades in, updating `<span id="district-name">`, `<span id="district-king">`, and `<span id="district-tax">`.
- **Citadel Button**: `<button id="citadel-btn">` becomes active when within interaction radius.
- **Citadel Menu**: `<div id="citadel-dialog">` opens, showing `<button id="citadel-action-btn">` (Challenge or Claim).
- **Income Tracker**: `<div id="income-tracker">` displays `<span id="income-amount">` accumulating over time.

### Underlying Logic
- **`checkCitadelProximity()`**: Constantly evaluates distance to the district's anchor point (`kingdom.js`).
- **`initiateChallengeLevel(district)` / `claimThrone(district)`**: Modifies the `castles` collection in Firestore to transfer ownership.
- **`processIncome()`**: A loop in `poi.js` that checks `gameState.player.capturedCastles`, calculating real-time elapsed rewards and incrementing `gameState.player.gold`.

---

## Scenario 4: The Merchant & The Smith (Shops & Inventory)

### Context & Pre-conditions
- **State**: Player has sufficient gold and empty inventory slots.
- **World**: A Shop POI marker is tapped on the map.

### Step-by-Step Flow
1. **Browsing**: The player opens the shop menu and sees available items.
2. **Inspection**: The player holds down on an item to see its stat bonuses.
3. **Purchase**: The player buys an "Epic" sword. Gold is deducted.
4. **Equipping**: The player opens their character inventory, selects the new sword, and equips it to the "Weapon" slot.

### UI/Screen Breakdown
- **Shop Dialog**: `<div id="poi-dialog">` populated with an item list by `showShopMenu(shop)`.
- **Item Preview**: `<div id="item-preview-tooltip">` appears on `onmousedown` showing `statsHtml`.
- **Buy Button**: Triggers inline `onclick="window.buyItem('itemId', price)"`.
- **Character Panel**: Shows the equipment slots where the user clicks "Equip" on the item.

### Underlying Logic
- **`showShopMenu(shop)`**: Dynamically maps `ITEMS_DB` to generate the HTML string (`poi.js`).
- **`buyItem(itemId, price)`**: Verifies `gameState.player.gold`, pushes `{ id: itemId, quantity: 1 }` to `gameState.inventory`, and calls `saveGame()`.
- **`equipItem(itemId, slot)`**: Swaps the current item in `gameState.equipment[slot]` with the new one (`ui-controller.js`).
- **`recalculateStats()`**: Crucial call in `gameState.js` that iterates over base attributes, adds equipment affixes, and calculates effective damage/defense/HP, pushing the new values to the UI via `updateHUD()`.

---

## Scenario 5: The Fellowship (Group Combat)

### Context & Pre-conditions
- **State**: Player A and Player B are nearby.
- **World**: A "Super Unique" monster is on the map, requiring multiple players to defeat.

### Step-by-Step Flow
1. **Party Formation**: Player A invites Player B to a group. B accepts.
2. **Initiation**: Player A clicks the Super Unique monster and starts Group Combat.
3. **Call to Arms**: Player B receives a notification that their group is in combat and joins the fight.
4. **Shared Battlefield**: Both players attack the same target. Damage is synchronized and distributed.
5. **Shared Victory**: The monster falls, and both players receive XP and loot.

### UI/Screen Breakdown
- **Group HUD**: `<div id="group-hud">` appears, listing party members.
- **Combat Screen**: Both players see `<div id="combat-screen">`, but the monster's HP bar syncs across clients.
- **Event Log**: `<div id="event-log-panel">` shows "Player B hit the monster for 45 damage".

### Underlying Logic
- **`invitePlayerToGroup(targetCharId)` / `acceptGroupInvite(groupId)`**: Manages the `groups/{groupId}` node in RTDB (`groups.js`).
- **`startGroupCombat(monster)`**: Initiator creates a combat instance in the `combats/{combatId}` RTDB node.
- **`joinUnifiedCombat(combatId)`**: Group members detect the active combat state and join the existing session (`combat.js`).
- **`resolveUnifiedRound(combatId, data)` / `distributeDamage(targetGroup, damage)`**: Aggregates damage from all participating players during the RTDB round sync and applies it collectively to the monster's HP.
