// FightCraft - Global Window Functions Test
// This file documents all functions that should be available globally

console.log('🔍 Testing global window function availability...');

const requiredFunctions = {
    // UI Navigation
    'openMenu': 'UI navigation function',
    'closeMenu': 'UI navigation function',
    'toggleEventLog': 'UI event log toggle',
    'clearEventLog': 'UI event log clear',

    // Settings
    'toggleSetting': 'Settings toggle function',
    'toggleDebugMode': 'Debug mode toggle',
    'toggleGameDebug': 'Debug mode toggle (alias)',

    // Map & Location
    'centerOnPlayer': 'Center map on player',
    'teleportToCoords': 'Teleport to coordinates',
    'updatePlayerPosition': 'Update player position',
    'setMoveSpeed': 'Set debug move speed',

    // Inventory & Items
    'filterInventory': 'Filter inventory items',
    'handleEquipSlot': 'Handle equipment slot click',
    'showItemDetails': 'Show item details modal',
    'equipItem': 'Equip an item',
    'useItem': 'Use a consumable item',
    'closeItemModal': 'Close item modal',

    // Combat
    'selectAttackZone': 'Select attack zone',
    'selectDefense': 'Select defense zone',
    'executeAttack': 'Execute attack',
    'fleeCombat': 'Flee from combat',
    'closeVictory': 'Close victory screen',
    'closeDefeat': 'Close defeat screen',
    'closeEncounter': 'Close encounter dialog',
    'startEncounterFight': 'Start encounter fight',

    // Character Stats
    'allocateStat': 'Allocate stat point',
    'addXP': 'Add experience points',

    // Game Management
    'resetGame': 'Reset game progress',

    // Debug/Test Functions
    'spawnTestMonsters': 'Spawn test monsters',
    'healPlayer': 'Heal player to full',
    'giveTestItems': 'Give test items',
    'addTestXP': 'Add test XP',
    'addTestGold': 'Add test gold'
};

let missingFunctions = [];
let availableFunctions = [];

Object.entries(requiredFunctions).forEach(([funcName, description]) => {
    if (typeof window[funcName] === 'function') {
        availableFunctions.push(funcName);
    } else {
        missingFunctions.push({ name: funcName, description });
    }
});

console.log(`✅ Available functions: ${availableFunctions.length}/${Object.keys(requiredFunctions).length}`);
console.log('Available:', availableFunctions);

if (missingFunctions.length > 0) {
    console.warn('⚠️ Missing functions:', missingFunctions);
    missingFunctions.forEach(({ name, description }) => {
        console.warn(`  - ${name}: ${description}`);
    });
} else {
    console.log('🎉 All required functions are available!');
}

// Export for debugging
window.__checkGlobalFunctions = () => {
    console.table(
        Object.keys(requiredFunctions).map(name => ({
            Function: name,
            Available: typeof window[name] === 'function' ? '✅' : '❌',
            Type: typeof window[name]
        }))
    );
};

console.log('💡 Run window.__checkGlobalFunctions() to see detailed status');
