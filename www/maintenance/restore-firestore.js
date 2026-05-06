// Firebase Restore Script
// Run in browser console (F12) when on http://localhost:8080

console.log('🔄 Firebase Restore Script\n');
console.log('⚠️ WARNING: This will restore data from backup file\n');

async function restoreFirestore(backupData) {
    const { getFirestore, doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getFirestore();

    if (!backupData || !backupData.documents) {
        console.error('❌ Invalid backup data');
        return;
    }

    console.log(`📊 Found ${backupData.documents.length} documents to restore`);
    console.log(`📅 Backup date: ${backupData.exportDate}\n`);

    const confirm = window.confirm(
        `Restore ${backupData.documents.length} documents from backup?\n\n` +
        `This will overwrite existing data with matching IDs.`
    );

    if (!confirm) {
        console.log('❌ Restore cancelled');
        return;
    }

    let restored = 0;
    let failed = 0;

    for (const item of backupData.documents) {
        try {
            const userRef = doc(db, 'users', item.id);

            // Restore timestamps
            const data = {
                ...item.data,
                lastSave: serverTimestamp(),
                restoredAt: serverTimestamp()
            };

            await setDoc(userRef, data);

            console.log(`✅ Restored: ${item.id.substring(0, 12)}... (${item.data.player?.name})`);
            restored++;

        } catch (error) {
            console.error(`❌ Failed to restore ${item.id}:`, error.message);
            failed++;
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n📊 Restore complete!`);
    console.log(`   ✅ Restored: ${restored}`);
    console.log(`   ❌ Failed: ${failed}`);
}

// Instructions for user
console.log('📖 How to use:\n');
console.log('1. Load your backup JSON file:');
console.log('   const backup = JSON.parse(\'<paste JSON here>\');\n');
console.log('2. Or upload file via input:');
console.log('   const input = document.createElement(\'input\');');
console.log('   input.type = \'file\';');
console.log('   input.accept = \'.json\';');
console.log('   input.onchange = (e) => {');
console.log('       const file = e.target.files[0];');
console.log('       const reader = new FileReader();');
console.log('       reader.onload = (event) => {');
console.log('           const backup = JSON.parse(event.target.result);');
console.log('           restoreFirestore(backup);');
console.log('       };');
console.log('       reader.readAsText(file);');
console.log('   };');
console.log('   input.click();\n');

// Make restore function global
window.restoreFirestore = restoreFirestore;

// Helper to upload and restore
window.uploadAndRestore = function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const backup = JSON.parse(event.target.result);
                restoreFirestore(backup);
            } catch (error) {
                console.error('❌ Failed to parse backup file:', error);
            }
        };
        reader.readAsText(file);
    };
    input.click();
};

console.log('✅ Restore script loaded!');
console.log('💡 Quick restore: uploadAndRestore()');
