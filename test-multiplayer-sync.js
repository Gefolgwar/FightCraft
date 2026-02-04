/* 
 * MULTIPLAYER DEBUG TEST SCRIPT
 * Paste this into browser console to test player sync
 */

console.log('🧪 Starting Multiplayer Debug Test...');

// Test 1: Check if functions exist
console.log('\n📋 Test 1: Function Availability');
console.log('✓ window.updateOtherPlayers:', typeof window.updateOtherPlayers);
console.log('✓ window.map:', typeof window.map);

// Test 2: Import Firebase service
console.log('\n📋 Test 2: Firebase Service');
import('./firebase-service.js').then(firebase => {
    console.log('✓ getAllPlayersForDebug:', typeof firebase.getAllPlayersForDebug);
    console.log('✓ subscribeToPlayers:', typeof firebase.subscribeToPlayers);
    console.log('✓ getCurrentUser:', typeof firebase.getCurrentUser);

    const currentUser = firebase.getCurrentUser();
    console.log('✓ Current User:', currentUser ? currentUser.uid.substring(0, 12) + '...' : 'Not authenticated');

    // Test 3: Get all players
    console.log('\n📋 Test 3: Loading Players...');
    firebase.getAllPlayersForDebug().then(players => {
        console.log(`✓ Found ${players.length} players:`, players);

        // Test 4: Try to render them
        console.log('\n📋 Test 4: Rendering Players on Map...');
        if (window.updateOtherPlayers && window.map) {
            // Filter out self
            const others = players.filter(p => !p.isSelf);
            console.log(`✓ Rendering ${others.length} other players...`);
            window.updateOtherPlayers(others);
            console.log('✓ Update called successfully!');
        } else {
            console.error('❌ Map or updateOtherPlayers not available');
        }

        // Test 5: Create a test player
        console.log('\n📋 Test 5: Creating Test Player...');
        firebase.createTestPlayer().then(newPlayer => {
            if (newPlayer) {
                console.log('✓ Test player created:', newPlayer.player.name);
                // Reload players after 1 second
                setTimeout(() => {
                    console.log('\n📋 Test 6: Reloading Players...');
                    firebase.getAllPlayersForDebug().then(updated => {
                        console.log(`✓ Now have ${updated.length} players`);
                        const others = updated.filter(p => !p.isSelf);
                        window.updateOtherPlayers(others);
                        console.log('✅ Test Complete!');
                    });
                }, 1000);
            } else {
                console.error('❌ createTestPlayer returned null - check permissions');
                console.log('💡 Solution: Deploy Firebase rules from firestore.rules file');
            }
        }).catch(err => {
            console.error('��� Error creating test player:', err);
            if (err.code === 'permission-denied') {
                console.log('💡 Solution 1: Open Firebase Console');
                console.log('💡 Solution 2: Go to Firestore → Rules');
                console.log('💡 Solution 3: Copy rules from firestore.rules file');
                console.log('💡 Solution 4: Click Publish');
            }
        });
    });
});

// Test 7: Subscribe to real-time updates
console.log('\n📋 Test 7: Setting up Real-time Subscription...');
import('./firebase-service.js').then(firebase => {
    const unsubscribe = firebase.subscribeToPlayers((players) => {
        console.log('📡 Real-time update received:', players.length, 'players');
        const others = players; // subscribeToPlayers already filters out self
        window.updateOtherPlayers(others);
    });

    console.log('✓ Subscription active!');
    console.log('💡 Call unsubscribe() to stop');
    window._testUnsubscribe = unsubscribe;
});
