// One-time Migration Script: Monster Templates to Firestore
// Run this in browser console on the game page while logged in as admin

import { MONSTER_LIBRARY } from '../gameplay/data.js';
import { saveTemplate } from '../firebase/firebase-service.js';

async function migrateMonsterTemplates() {
    console.log('🚀 Starting Monster Templates Migration...');
    console.log(`Found ${MONSTER_LIBRARY.length} monsters to migrate`);

    let successCount = 0;
    let failCount = 0;

    // Calculate default weights (equal distribution for now)
    const defaultWeight = Math.floor(100 / MONSTER_LIBRARY.length);

    for (const monster of MONSTER_LIBRARY) {
        try {
            const template = {
                id: `monster_${monster.templateId}`,
                type: 'monster',
                name: monster.name,
                icon: monster.icon,
                class: monster.class,
                level: monster.level,
                hp: monster.hp,
                damage: monster.damage,
                defense: monster.defense,
                xpReward: monster.xpReward,
                goldReward: monster.goldReward,
                monsterType: monster.type,
                affixes: monster.affixes || [],
                weight: defaultWeight,
                // Add original templateId for reference
                originalTemplateId: monster.templateId
            };

            const success = await saveTemplate(template);
            if (success) {
                successCount++;
                console.log(`✅ Migrated: ${monster.name} (${monster.templateId})`);
            } else {
                failCount++;
                console.error(`❌ Failed: ${monster.name}`);
            }
        } catch (error) {
            failCount++;
            console.error(`❌ Error migrating ${monster.name}:`, error);
        }
    }

    console.log('\n📊 Migration Complete:');
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('\n🔄 Refresh the Monsters Admin page to see the templates!');
}

// Auto-run if imported directly
if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
    console.log('⚠️ Monster Migration Script Loaded');
    console.log('📝 Run: window.migrateMonsterTemplates()');
    window.migrateMonsterTemplates = migrateMonsterTemplates;
}

export { migrateMonsterTemplates };
