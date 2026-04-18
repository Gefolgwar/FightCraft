
import { gameState } from '../core/gameState.js';
import { saveGame } from '../core/app.js';
import { getDistrictByCoords, refreshDistricts } from './districts.js';
import { showNotification, addEventLog, updateHUD } from '../ui/ui-controller.js';
import { getDistance } from './map.js';

// ==================== KINGDOM MANAGER ====================

export function initKingdom() {
    console.log('👑 Kingdom System Initialized');
    // Check for citadel proximity every few seconds
    setInterval(checkCitadelProximity, 5000);
}

// Check if player is near the Citadel of the current district
export function checkCitadelProximity() {
    if (!gameState.currentDistrict) return;

    const district = gameState.currentDistrict;
    // Support new dynamic structure (center) or old structure (citadel object)
    const targetPos = district.citadel || district.center;
    const targetName = district.citadel ? district.citadel.name : (district.name + " Citadel");

    if (!targetPos) return;

    const playerPos = gameState.player.position;
    const dist = getDistance(playerPos.lat, playerPos.lng, targetPos.lat, targetPos.lng);

    // Interaction radius for Citadel (e.g., 50m)
    if (dist <= 50) {
        if (!gameState.nearCitadel) {
            gameState.nearCitadel = true;
            showNotification(`🏰 You are at the ${targetName}!`, 'success');
            // Show interaction button or automatically open dialog?
            // For now, let's show a floating action button or just a notification hint
            document.getElementById('citadel-btn').classList.remove('hidden');
        }
    } else {
        if (gameState.nearCitadel) {
            gameState.nearCitadel = false;
            document.getElementById('citadel-btn').classList.add('hidden');
            document.getElementById('citadel-dialog').classList.add('hidden');
        }
    }
}

// Open the Citadel interaction menu
export function openCitadelMenu() {
    if (!gameState.currentDistrict) return;

    const district = gameState.currentDistrict;
    const ui = document.getElementById('citadel-dialog');

    // Normalize data
    const citadelName = district.citadel ? district.citadel.name : (district.name + " Citadel");

    // Update UI Content
    document.getElementById('citadel-title').textContent = citadelName;
    document.getElementById('citadel-district').textContent = district.name;
    document.getElementById('citadel-ruler').textContent = district.kingName || 'None';

    // Determine Logic
    const isKing = district.kingId === gameState.player.id; // Assuming we have player ID
    const hasKing = !!district.kingId;

    const actionBtn = document.getElementById('citadel-action-btn');
    const statusText = document.getElementById('citadel-status-text');

    if (isKing) {
        statusText.textContent = "You are the King of this district.";
        actionBtn.textContent = "Manage Taxes";
        actionBtn.onclick = () => showNotification('Tax management coming soon!', 'info');
        actionBtn.className = "w-full py-3 bg-blue-600 rounded-lg font-bold hover:bg-blue-500";

        // Show Safe Storage button
        const storageBtn = document.createElement('button');
        storageBtn.className = "w-full mt-2 py-3 bg-green-700 rounded-lg font-bold hover:bg-green-600";
        storageBtn.textContent = "📦 Open Safe Storage";
        storageBtn.onclick = () => window.openStorage();
        if (!document.getElementById('citadel-storage-btn')) {
            storageBtn.id = 'citadel-storage-btn';
            actionBtn.parentNode.insertBefore(storageBtn, actionBtn.nextSibling);
        }
    } else if (hasKing) {
        statusText.textContent = `Controlled by ${district.kingName}. Win rate: 65%`;
        actionBtn.textContent = "⚔️ Challenge for the Throne";
        actionBtn.onclick = () => showChallengeDialog(district);
        actionBtn.className = "w-full py-3 bg-red-600 rounded-lg font-bold hover:bg-red-500 animate-pulse";
    } else {
        statusText.textContent = "This district has no ruler!";
        actionBtn.textContent = "👑 Claim Throne";
        actionBtn.onclick = () => claimThrone(district);
        actionBtn.className = "w-full py-3 bg-yellow-600 rounded-lg font-bold hover:bg-yellow-500";
    }

    ui.classList.remove('hidden');
}

export function closeCitadelMenu() {
    document.getElementById('citadel-dialog').classList.add('hidden');
}

function showChallengeDialog(district) {
    if (confirm(`Do you want to challenge ${district.kingName} for the throne?\n\nCost: 500 Gold\nWin Condition: PvP Duel`)) {
        if (gameState.player.gold < 500) {
            showNotification('❌ Not enough gold to pay the challenge fee!', 'error');
            return;
        }

        // Deduct Fee
        gameState.player.gold -= 500;
        updateHUD();

        // Simulate Challenge Logic (Step 2 Implementation)
        // In real app, this would notify the King via Firebase

        initiateChallengeLevel(district);
    }
}

function initiateChallengeLevel(district) {
    // For now, simple simulation or PvE fight against King's AI
    showNotification(`⚔️ Challenge Request Sent to ${district.kingName}!`, 'success');
    addEventLog(`Challenged ${district.kingName} for control of ${district.name}`, 'combat');

    // Mock Battle Start
    setTimeout(() => {
        if (confirm("The King has accepted your challenge! Enter the arena?")) {
            // Start simulated combat
            // For MVP, we can treat the King as a "Boss Monster"
            startKingBossFight(district);
        }
    }, 2000);
}

function startKingBossFight(district) {
    closeCitadelMenu();

    // Create a temporary boss monster representing the King
    const kingBoss = {
        id: `king_${district.id}`,
        name: district.kingName,
        icon: '👑',
        level: 42, // As per usage request
        hp: 500,
        maxHp: 500,
        damage: 40,
        defense: 20,
        xpReward: 2000,
        goldReward: 1000,
        isKing: true,
        districtId: district.id
    };

    // Use existing combat system
    import('../gameplay/combat.js').then(({ startCombat }) => {
        startCombat(kingBoss);
    });
}

function claimThrone(district) {
    if (confirm("Claim this unclaimed district? It will cost 1000 Gold to establish your rule.")) {
        if (gameState.player.gold < 1000) {
            showNotification('❌ Not enough gold (1000 needed)', 'error');
            return;
        }

        gameState.player.gold -= 1000;
        updateHUD();

        // Update District Data (Local Simulation)
        district.kingId = 'player_me';
        district.kingName = gameState.player.name || 'You';

        showNotification(`👑 Hail to the King! You now control ${district.name}!`, 'success');
        addEventLog(`Claimed the throne of ${district.name}`, 'success');

        closeCitadelMenu();
        refreshDistricts(); // Update map colors immediately

        if (window.updateDistrictHUD) window.updateDistrictHUD();
    }
}

// Expose to window
window.openCitadelMenu = openCitadelMenu;
window.closeCitadelMenu = closeCitadelMenu;
