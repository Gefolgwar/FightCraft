// Firebase Backup Script
// Run in browser console (F12) when on http://localhost:8080

console.log('🔥 Starting Firebase Backup...\n');

async function backupFirestore() {
    const { getFirestore, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getFirestore();

    console.log('📡 Connecting to Firestore...');

    try {
        // Get all documents from 'users' collection
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);

        console.log(`✅ Found ${snapshot.size} user documents\n`);

        const backup = {
            exportDate: new Date().toISOString(),
            collection: 'users',
            documents: []
        };

        snapshot.forEach((doc) => {
            const data = doc.data();

            console.log(`📄 Backing up: ${doc.id.substring(0, 12)}...`);
            console.log(`   Name: ${data.player?.name || 'Unknown'}`);
            console.log(`   Level: ${data.player?.level || 1}`);

            backup.documents.push({
                id: doc.id,
                data: {
                    ...data,
                    // Convert Timestamps to ISO strings
                    lastSave: data.lastSave?.toDate?.()?.toISOString() || null,
                    lastLocationUpdate: data.lastLocationUpdate?.toDate?.()?.toISOString() || null,
                    createdAt: data.createdAt?.toDate?.()?.toISOString() || null
                }
            });
        });

        console.log(`\n✅ Backup complete! ${backup.documents.length} documents\n`);

        // Convert to JSON
        const json = JSON.stringify(backup, null, 2);

        // Create download
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `firestore-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();

        console.log('💾 Backup file downloaded!\n');
        console.log('📊 Summary:');
        console.table(backup.documents.map(d => ({
            ID: d.id.substring(0, 12) + '...',
            Name: d.data.player?.name || 'Unknown',
            Level: d.data.player?.level || 1,
            Gold: d.data.player?.gold || 0,
            IsTest: d.data.isTestPlayer ? 'YES' : 'No'
        })));

        return backup;

    } catch (error) {
        console.error('❌ Backup failed:', error);
        throw error;
    }
}

// Run backup
backupFirestore().then(() => {
    console.log('\n✅ All done! Check your Downloads folder.');
}).catch(err => {
    console.error('\n❌ Error:', err.message);
});
