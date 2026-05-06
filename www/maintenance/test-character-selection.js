// Quick Test Script for Character Selection System
// Run in browser console (F12)

console.log('🧪 Character Selection Test Suite\n');

async function runTests() {
    console.log('=== TEST 1: UI Elements ===');

    // Check if character selection screen exists
    const charScreen = document.getElementById('character-selection-screen');
    console.log(charScreen ? '✅ Character Selection Screen: Found' : '❌ Character Selection Screen: NOT FOUND');

    // Check if multiplayer panel exists
    const mpPanel = document.getElementById('multiplayer-panel');
    console.log(mpPanel ? '✅ Multiplayer Panel: Found' : '❌ Multiplayer Panel: NOT FOUND');

    // Check if game container exists
    const gameContainer = document.getElementById('game-container');
    console.log(gameContainer ? '✅ Game Container: Found' : '❌ Game Container: NOT FOUND');

    console.log('\n=== TEST 2: localStorage ===');

    // Check if character ID is saved
    const savedCharId = localStorage.getItem('selectedCharacterId');
    console.log(savedCharId ? `✅ Saved Character ID: ${savedCharId}` : '⚠️ No saved character (normal on first load)');

    console.log('\n=== TEST 3: Global Variables ===');

    // Check if global variables are set
    console.log(window._currentUserId ? `✅ User ID: ${window._currentUserId.substring(0, 12)}...` : '⚠️ User ID: Not set (normal before game starts)');
    console.log(window._currentCharacterId ? `✅ Character ID: ${window._currentCharacterId}` : '⚠️ Character ID: Not set (normal before game starts)');

    console.log('\n=== TEST 4: Functions ===');

    // Check if critical functions exist
    const functions = [
        'startGameWithCharacter',
        'toggleMultiplayerPanel',
        'mpPanelViewPlayer',
        'mpPanelDeletePlayer',
        'mpPanelShowAll',
        'mpPanelCreate'
    ];

    functions.forEach(fn => {
        console.log(typeof window[fn] === 'function' ? `✅ ${fn}: Loaded` : `❌ ${fn}: NOT LOADED`);
    });

    console.log('\n=== TEST 5: Firebase ===');

    try {
        const { getCurrentUser } = await import('./js/firebase-service.js');
        const user = getCurrentUser();
        console.log(user ? `✅ Firebase Auth: Connected (${user.uid.substring(0, 12)}...)` : '⚠️ Firebase Auth: Not signed in yet');
    } catch (error) {
        console.log(`❌ Firebase: Error - ${error.message}`);
    }

    console.log('\n=== TEST 6: Character Selection Module ===');

    try {
        const charSelection = await import('./js/character-selection.js');
        console.log('✅ Character Selection Module: Loaded');
        console.log('   - initCharacterSelection:', typeof charSelection.initCharacterSelection);
        console.log('   - selectCharacter:', typeof charSelection.selectCharacter);
        console.log('   - loadCharactersList:', typeof charSelection.loadCharactersList);
    } catch (error) {
        console.log(`❌ Character Selection Module: Error - ${error.message}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log('✅ All critical components checked');
    console.log('\n💡 Next Steps:');
    console.log('1. Clear localStorage: localStorage.clear()');
    console.log('2. Reload page: location.reload()');
    console.log('3. Should see Character Selection Screen');
    console.log('4. Create a character and test!');
}

// Run tests
runTests().then(() => {
    console.log('\n✅ Tests complete!');
}).catch(err => {
    console.error('\n❌ Test failed:', err);
});
