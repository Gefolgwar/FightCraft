// Cleanup script - run in browser console to delete testplayer103

(async function cleanup() {
    try {
        const { deleteCharacter, getAllCharacters, getCurrentUser } = await import('./js/firebase-service.js');
        const user = getCurrentUser();

        if (!user) {
            console.error('❌ No user logged in');
            return;
        }

        console.log('🔍 Searching for testplayer103...');
        const chars = await getAllCharacters(user.uid);
        console.log(`📋 Found ${chars.length} total characters`);

        // Find all test players
        const testPlayers = chars.filter(c => c.data?.player?.name?.includes('TestPlayer'));
        console.log(`🤖 Found ${testPlayers.length} test players:`, testPlayers.map(p => p.data.player.name));

        // Find testplayer103
        const tp103 = chars.find(c => c.data.player?.name === 'TestPlayer103');

        if (tp103) {
            console.log(`❌ Deleting ${tp103.data.player.name} (ID: ${tp103.id})...`);
            await deleteCharacter(user.uid, tp103.id);
            console.log('✅ testplayer103 deleted successfully!');

            // Reload page to refresh
            console.log('🔄 Reloading page...');
            setTimeout(() => location.reload(), 1000);
        } else {
            console.log('✅ testplayer103 not found (already deleted or never existed)');
        }
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    }
})();
