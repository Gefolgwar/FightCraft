
import { isAdmin, getTemplates, initFirebase } from './firebase-service.js';

async function init() {
    // Initialize Auth first
    await initFirebase();

    const admin = isAdmin();
    const statusEl = document.getElementById('admin-status');
    const panel = document.getElementById('admin-panel');
    const loading = document.getElementById('loading');

    if (admin) {
        statusEl.textContent = '✅ Admin Access Granted';
        statusEl.classList.add('text-green-400');
        statusEl.classList.remove('text-gray-400');
        panel.classList.remove('hidden');
        panel.classList.add('flex');
        loading.classList.add('hidden');
    } else {
        statusEl.textContent = '❌ Access Denied';
        statusEl.classList.add('text-red-400');
        statusEl.classList.remove('text-gray-400');
        loading.innerHTML = '<p class="text-red-500">You must be an admin to view this page.</p>';
        return;
    }

    renderLevelTable();
    await renderMonsterTable();
    renderCastleTable();
}

function renderLevelTable() {
    const list = document.getElementById('level-list');
    let html = '';
    let totalXp = 0;

    for (let l = 1; l <= 100; l++) {
        const xpNeeded = 500 * l * l;
        totalXp += xpNeeded;

        html += `
            <div class="flex justify-between px-4 py-2 border-b border-gray-800 hover:bg-gray-800/50 transition text-sm">
                <span class="font-bold text-gray-300 w-10 text-center">${l}</span>
                <span class="font-mono text-yellow-500 text-right flex-1">${xpNeeded.toLocaleString()}</span>
            </div>
        `;
    }

    list.innerHTML = html;
    document.getElementById('total-xp-max').textContent = formatNumber(totalXp);
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

async function renderMonsterTable() {
    const tableBody = document.getElementById('monster-xp-table');

    // Fetch templates from Firebase using the correct function
    let templates = [];
    try {
        templates = await getTemplates('monster');
    } catch (e) {
        console.error('Failed to fetch templates', e);
    }

    if (templates.length === 0) {
        // Fallback to library in data.js if empty (legacy)
        try {
            const { MONSTER_LIBRARY } = await import('./data.js');
            templates = MONSTER_LIBRARY.map(m => ({
                name: m.name,
                icon: m.icon,
                class: m.class || 'normal',
                xpReward: m.xpReward || 50, // Use pre-calculated or default
                level: m.level || 1,
                hp: m.hp
            }));
        } catch (e) {
            console.error('Failed to load local library', e);
        }
    }

    // Sort by XP reward
    // Note: If templates don't have explicit 'xpReward' saved (because it's calculated at spawn),
    // we need to calculate it here using the formula.

    const processed = templates.map(t => {
        let level = t.level || 1;
        let cls = t.class || 'normal';

        // Formula from monsters.js
        const xpMult = cls === 'champion' ? 3 : cls === 'unique' ? 10 : cls === 'superUnique' ? 50 : 1;

        // If xpReward is not hardcoded, calculate it
        let xp = t.xpReward;
        if (!xp) {
            xp = Math.max(50, Math.round((level ** 1.3) * xpMult));
        }

        return { ...t, xp, cls, level };
    }).sort((a, b) => a.xp - b.xp);

    const countEl = document.getElementById('monster-count');
    if (countEl) countEl.textContent = `${processed.length} templates`;

    let totalXp = 0;

    if (tableBody) {
        tableBody.innerHTML = processed.map(m => {
            totalXp += m.xp;

            // XP Needed for Level 1 is 500
            const killsForLvl1 = Math.ceil(500 / (m.xp || 1));

            const rarityColor =
                m.cls === 'champion' ? 'text-blue-400' :
                    m.cls === 'unique' ? 'text-purple-400' :
                        m.cls === 'superUnique' ? 'text-yellow-400' : 'text-gray-400';

            return `
                <tr class="hover:bg-gray-700/50 transition border-b border-gray-800">
                    <td class="px-6 py-3 flex items-center gap-3">
                        <span class="text-2xl">${m.icon || '👾'}</span>
                        <span class="font-bold text-gray-200">${m.name}</span>
                    </td>
                    <td class="px-6 py-3 font-mono text-gray-400">${m.level}</td>
                    <td class="px-6 py-3 ${rarityColor} font-bold capitalize">${m.cls}</td>
                    <td class="px-6 py-3 text-right font-mono text-green-400 font-bold">+${m.xp.toLocaleString()}</td>
                    <td class="px-6 py-3 text-right text-gray-500">${killsForLvl1}</td>
                </tr>
            `;
        }).join('');
    }

    if (processed.length > 0) {
        document.getElementById('avg-monster-xp').textContent = Math.round(totalXp / processed.length).toLocaleString();
    }
}

function renderCastleTable() {
    const tableBody = document.getElementById('castle-xp-table');

    // Generate rows for Castle Levels 1-10
    let html = '';

    for (let i = 1; i <= 20; i++) {
        const xp = i * 50;
        const gold = i * 10;

        html += `
            <tr class="hover:bg-gray-700/50 transition border-b border-gray-800">
                <td class="px-6 py-3 font-bold text-yellow-500">Level ${i}</td>
                <td class="px-6 py-3 text-gray-400">Guardian Lv.${i}</td>
                <td class="px-6 py-3 text-right font-mono text-green-400 font-bold">+${xp.toLocaleString()}</td>
                <td class="px-6 py-3 text-right font-mono text-yellow-400">brings ${gold} 💰 in 10 minutes</td>
            </tr>
        `;
    }

    tableBody.innerHTML = html;
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);
