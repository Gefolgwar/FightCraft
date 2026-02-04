// EMERGENCY CLEANUP - Remove TestPlayer103
// Paste this ENTIRE code into browser console (F12 -> Console tab)

(async function emergencyCleanup() {
    console.log('🧹 Starting emergency cleanup...');

    // 1. Remove from map markers
    try {
        const { otherPlayerMarkers } = await import('./js/map.js');

        console.log('📍 Current map markers:', Object.keys(otherPlayerMarkers));

        // Find and remove TestPlayer103
        for (const [id, marker] of Object.entries(otherPlayerMarkers)) {
            const markerEl = marker.getElement();
            const text = markerEl?.textContent || '';

            if (text.includes('TestPlayer103') || text.includes('TestPlayer')) {
                console.log(`❌ Removing marker: ${id} (${text})`);
                marker.remove();
                delete otherPlayerMarkers[id];
            }
        }

        console.log('✅ Map cleaned. Remaining markers:', Object.keys(otherPlayerMarkers));
    } catch (e) {
        console.error('Error cleaning map:', e);
    }

    // 2. Remove from Firebase
    try {
        const { getAllCharacters, deleteCharacter, getCurrentUser } = await import('./js/firebase-service.js');
        const user = getCurrentUser();

        if (!user) {
            console.log('⚠️ No user logged in, skipping Firebase cleanup');
            return;
        }

        const chars = await getAllCharacters(user.uid);
        console.log(`📋 Found ${chars.length} characters in Firebase`);

        for (const char of chars) {
            const name = char.data?.player?.name || 'Unknown';

            if (name.includes('TestPlayer')) {
                console.log(`❌ Deleting from Firebase: ${name} (${char.id})`);
                await deleteCharacter(user.uid, char.id);
                console.log(`✅ Deleted ${name}`);
            }
        }

        console.log('✅ Firebase cleanup complete!');

    } catch (e) {
        console.error('Error cleaning Firebase:', e);
    }

    console.log('🎉 Cleanup complete! Reloading page...');
    setTimeout(() => location.reload(), 1500);
})();
