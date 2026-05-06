// RESTORE GEOPARDYONOK
// Run this in console to fix the corrupted character data

(async function restoreChar() {
    console.log('🚑 Starting Emergency Restoration...');

    const { getDb, getCurrentUser } = await import('../firebase/firebase-service.js');
    const { doc, updateDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getDb();
    const currentUser = getCurrentUser();

    if (!currentUser) return console.error('❌ Not logged in');

    // ID found in logs: df3yQrY5kHeGSrjc4ymZ
    // Or we can find by current user
    const charId = 'df3yQrY5kHeGSrjc4ymZ';
    const charRef = doc(db, 'users', currentUser.uid, 'characters', charId);

    try {
        const snap = await getDoc(charRef);
        if (!snap.exists()) {
            console.error('❌ Character not found:', charId);
            return;
        }

        const data = snap.data();
        console.log('Current Data:', data.player.name, data.player.avatar);

        if (data.player.name.includes('TestPlayer')) {
            console.log('🛠️ Found corrupted data. Restoring...');

            await updateDoc(charRef, {
                'player.name': 'Geopardyonok',
                'player.avatar': '🧙',
                'player.class': 'mage', // Assuming mage
                'isTestPlayer': false,
                'name': 'Geopardyonok' // Root level just in case
            });

            console.log('✅ RESTORATION COMPLETE! Reloading...');
            setTimeout(() => location.reload(), 1000);
        } else {
            console.log('✅ Data seems fine already.');
        }

    } catch (e) {
        console.error('❌ Restoration failed:', e);
    }
})();
