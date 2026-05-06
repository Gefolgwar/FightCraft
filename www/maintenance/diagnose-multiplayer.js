// DIAGNOSTIC SCRIPT - Run in Browser Console
// Copy and paste this entire script into browser console (F12)

console.log('🔍 Starting Player Diagnostics...\n');

async function diagnoseMultiplayer() {
    const { getAllPlayersForDebug } = await import('./firebase-service.js');

    console.log('📊 Loading all players from Firebase...');
    const players = await getAllPlayersForDebug();

    console.log(`\n✅ Found ${players.length} players in database\n`);

    // Detailed table
    console.table(players.map(p => ({
        Name: p.name,
        Level: p.level,
        Lat: p.position?.lat || 0,
        Lng: p.position?.lng || 0,
        isSelf: p.isSelf ? '👤 YES' : '👥 No',
        isTest: p.isTestPlayer ? '🧪 YES' : '❌ No',
        ID: p.id.substring(0, 12) + '...'
    })));

    // Problems detection
    console.log('\n🚨 Problems Detected:');

    const unknownPlayers = players.filter(p => p.name === 'Unknown');
    if (unknownPlayers.length > 0) {
        console.warn(`❌ ${unknownPlayers.length} players with name "Unknown"`);
        console.log('   → These players have no player.name in database');
    }

    const noPosition = players.filter(p => !p.position || (p.position.lat === 0 && p.position.lng === 0));
    if (noPosition.length > 0) {
        console.warn(`❌ ${noPosition.length} players with no valid position`);
        console.log('   → These players have position: { lat: 0, lng: 0 } or missing');
    }

    const notTestPlayers = players.filter(p => !p.isTestPlayer && !p.isSelf);
    if (notTestPlayers.length > 0) {
        console.warn(`❌ ${notTestPlayers.length} players are NOT test players`);
        console.log('   → These cannot be deleted with Delete button');
        console.log('   → They need isTestPlayer: true in database');
    }

    // Solutions
    console.log('\n💡 Solutions:\n');

    if (unknownPlayers.length > 0) {
        console.log('1. Fix "Unknown" names:');
        console.log('   Option A: Create new test players (they will have proper names)');
        console.log('   Option B: Fix in Firebase Console manually');
    }

    if (notTestPlayers.length > 0) {
        console.log('\n2. Fix isTestPlayer flag:');
        console.log('   Open Firebase Console → Firestore → users collection');
        console.log('   For each test player document, add field:');
        console.log('   isTestPlayer: true (boolean)');

        console.log('\n   IDs to fix:');
        notTestPlayers.forEach(p => {
            if (!p.isSelf) {
                console.log(`   - ${p.id} (${p.name}, Lv.${p.level})`);
            }
        });
    }

    console.log('\n3. Delete ALL old test data:');
    console.log('   Run: deleteAllUnknownPlayers() (see function below)');

    return players;
}

// Function to delete all "Unknown" players
window.deleteAllUnknownPlayers = async function () {
    const { getAllPlayersForDebug } = await import('./firebase-service.js');
    const players = await getAllPlayersForDebug();

    const unknownPlayers = players.filter(p =>
        p.name === 'Unknown' && !p.isSelf
    );

    if (unknownPlayers.length === 0) {
        console.log('✅ No "Unknown" players to delete');
        return;
    }

    const confirm = window.confirm(
        `Delete ${unknownPlayers.length} "Unknown" players?\n\n` +
        unknownPlayers.map(p => `- ${p.name} (Lv.${p.level})`).join('\n')
    );

    if (!confirm) {
        console.log('❌ Cancelled');
        return;
    }

    console.log(`🗑️ Deleting ${unknownPlayers.length} players...`);

    // Import Firebase
    const { getFirestore, doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const db = getFirestore();

    let deleted = 0;
    let failed = 0;

    for (const player of unknownPlayers) {
        try {
            await deleteDoc(doc(db, 'users', player.id));
            console.log(`✅ Deleted: ${player.id}`);
            deleted++;
        } catch (error) {
            console.error(`❌ Failed to delete ${player.id}:`, error.message);
            failed++;
        }
    }

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Deleted: ${deleted}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('\n🔄 Refresh player list to see changes');

    // Auto refresh
    if (window.refreshPlayersList) {
        setTimeout(() => window.refreshPlayersList(), 1000);
    }
};

// Run diagnostics
diagnoseMultiplayer().then(players => {
    console.log('\n✅ Diagnostics complete!');
    console.log('\n📋 Available commands:');
    console.log('   - diagnoseMultiplayer()          // Run diagnostics again');
    console.log('   - deleteAllUnknownPlayers()      // Delete all "Unknown" players');
    console.log('   - window.createTestPlayer()      // Create new test player');
    console.log('   - window.refreshPlayersList()    // Refresh list');
});
