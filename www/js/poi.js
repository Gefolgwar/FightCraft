import { gameState } from './gameState.js';
import { saveGame } from './app.js';
import { ITEMS_DB } from './data.js';
import { showNotification, updateHUD } from './ui-controller.js'; // fixed import path
import { map, getDistance, poiCluster } from './map.js';

// POI State
let nearbyPOIs = [];
let poiMarkers = [];
let lastFetchPos = null;
const FETCH_RADIUS = 500; // Reduced to 500m radius
const VISIBLE_RADIUS = 50000; // Show shops/castles within 50km (effectively global)
const MAX_VISIBLE_CASTLES = 999; // Essentially unlimited
const MAX_VISIBLE_SHOPS = 999;   // Essentially unlimited
const FETCH_THRESHOLD = 500; // Refetch if moved 500m
const CASTLE_TYPES = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food'];
const SHOP_TYPES = ['supermarket', 'convenience', 'kiosk', 'general'];
const INCOME_INTERVAL = 60 * 60 * 1000; // Hourly reward

export async function checkAndFetchPOIs() {
    // Disabled Overpass fetching. Now using database sync only as requested.
    return;
}

async function fetchPOIsFromOverpass(lat, lng) {
    // Disabled as requested. Using database sync instead.
}

function processOverpassData(elements) {
    // Clear old POIs
    nearbyPOIs = [];

    // Clear existing markers
    if (poiCluster) poiCluster.clearLayers();
    poiMarkers = [];

    elements.forEach(element => {
        const tags = element.tags || {};
        const lat = element.lat || element.center?.lat;
        const lng = element.lon || element.center?.lon;

        if (!lat || !lng) return;

        let type = 'unknown';
        if (tags.amenity && CASTLE_TYPES.some(t => tags.amenity.includes(t))) type = 'castle';
        if (tags.shop && SHOP_TYPES.some(t => tags.shop.includes(t))) type = 'shop';

        if (type === 'unknown') return;

        const poi = {
            id: element.id,
            type: type,
            lat: lat,
            lng: lng,
            name: tags.name || (type === 'castle' ? 'Abandoned Castle' : 'General Store'),
            tags: tags,
            level: 1 // Default level, will sync with Firestore later
        };

        nearbyPOIs.push(poi);
    });

    // Sort by distance to player
    const playerPos = gameState.player.position;
    nearbyPOIs.sort((a, b) => {
        const distA = getDistance(playerPos.lat, playerPos.lng, a.lat, a.lng);
        const distB = getDistance(playerPos.lat, playerPos.lng, b.lat, b.lng);
        return distA - distB;
    });

    // console.log(`🏰 Found ${nearbyPOIs.length} locations nearby (showing closest ones)`);
    renderPOIs();
}

export function addExternalPOIs(externalPOIs) {
    // Replace current nearbyPOIs with database objects
    nearbyPOIs = [...externalPOIs];

    // Sort by distance to player
    const playerPos = gameState.player.position;
    nearbyPOIs.sort((a, b) => {
        const distA = getDistance(playerPos.lat, playerPos.lng, a.lat, a.lng);
        const distB = getDistance(playerPos.lat, playerPos.lng, b.lat, b.lng);
        return distA - distB;
    });

    // console.log(`🏰 Synced ${externalPOIs.length} database POIs`);
    renderPOIs();
}

export function renderPOIs(center) {
    if (!map) return;

    // Clear existing markers first
    if (poiCluster) poiCluster.clearLayers();
    poiMarkers = [];

    // Use passed center or current map center (fallback to player)
    const renderCenter = center || map.getCenter();
    const playerPos = renderCenter; // Renaming for compatibility with loop below

    nearbyPOIs.forEach(poi => {
        const isCitadel = poi.icon === '🏯' || (poi.name && poi.name.includes('Citadel'));
        const isVault = poi.type === 'vault';

        // Optimization: Filter nearby only for performance (max 5km from center)
        // EXCEPTION: Citadels are ALWAYS rendered regardless of distance
        const distToCenter = getDistance(playerPos.lat, playerPos.lng, poi.lat, poi.lng);
        if (!isCitadel && distToCenter > 50000) return;

        // Render all synced POIs (No distance or quantity limit as requested)
        const isCastle = poi.type === 'castle';
        const ownerName = poi.ownerName;
        const isCaptured = isCastle && ownerName;
        const isMine = isCaptured && poi.ownerId === window._currentUserId;

        // PRIORITIZE icon from database object
        let iconChar = poi.icon;

        // FALLBACKS if icon is missing
        if (!iconChar) {
            if (isCastle) {
                // Check if it's a Citadel by name
                if (poi.name && poi.name.includes('Citadel')) iconChar = '🏯';
                else iconChar = '🏰';
            } else if (isVault) {
                iconChar = '📦'; // Chest icon
            } else {
                iconChar = '🏪'; // Default Shop icon
            }
        }

        // Visual indicator for captured castles
        let colorClass = isCastle ? 'bg-yellow-900/80 border-yellow-500' : 'bg-blue-900/80 border-blue-500';

        // Custom styling for Vaults
        if (isVault) {
            colorClass = 'bg-amber-800/80 border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.3)]';
        }

        if (isMine) {
            colorClass = 'bg-blue-600/80 border-white shadow-[0_0_15px_rgba(59,130,246,0.8)]';
        } else if (isCaptured) {
            colorClass = 'bg-red-900/80 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
        }

        // PREMIUM CITADEL MARKER (Requested Highlight)
        let iconHtml = '';
        let actualIconSize = [32, 32];
        let actualIconAnchor = [16, 16];
        let zIndex = isCastle ? 1800 : (isVault ? 1600 : 1500);

        if (iconChar === '🏯') {
            const glowColor = isMine ? '#00FF00' : (isCaptured ? '#FF0000' : '#FFFF00');
            actualIconSize = [48, 48];
            actualIconAnchor = [24, 24];
            zIndex = 2500; // Citadels on top
            iconHtml = `
                <div class="w-12 h-12 flex items-center justify-center relative bg-transparent">
                    <div class="absolute inset-0 rounded-full blur-md opacity-40" style="background: ${glowColor}"></div>
                    <div class="text-3xl filter drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] z-10 leading-none select-none">🏯</div>
                </div>
            `;
        } else {
            iconHtml = `<div class="relative flex items-center justify-center w-8 h-8 rounded-full border-2 ${colorClass} shadow-lg backdrop-blur-sm text-lg">
                    <span class="leading-none select-none">${iconChar}</span>
                    ${isCaptured ? '<div class="absolute -bottom-1 -right-1 text-[8px] bg-green-500 text-white rounded-full p-0.5 px-1 font-bold">✓</div>' : ''}
                   </div>`;
        }

        const icon = L.divIcon({
            html: iconHtml,
            className: 'custom-poi-icon',
            iconSize: actualIconSize,
            iconAnchor: actualIconAnchor
        });

        const marker = L.marker([poi.lat, poi.lng], {
            icon,
            zIndexOffset: zIndex // Added Indices
        });

        let ownerTag = '';
        if (isMine) ownerTag = `<div class="text-[9px] text-blue-300 mt-0.5 animate-pulse">⭐ Occupying</div>`;
        else if (isCaptured) ownerTag = `<div class="text-[9px] text-red-400 mt-0.5">🚩 Occupied by ${ownerName}</div>`;

        const popupContent = `
            <div class="text-center select-text">
                <b class="${isMine ? 'text-white' : (isCastle ? 'text-yellow-400' : 'text-blue-300')}" style="font-weight: bold; color: ${isCitadel ? '#facc15' : 'inherit'}">
                    ${poi.name}
                </b>
                <div class="text-[10px] text-gray-400">#${poi.id || 'N/A'}</div>
                <code class="text-[10px] text-blue-300" style="font-size: 10px; display: block; margin: 4px 0;">
                    ${poi.lat.toFixed(6)}, ${poi.lng.toFixed(6)}
                </code>
                ${ownerTag}
            </div>
        `;

        if (isCitadel) {
            marker.bindPopup(popupContent, { minWidth: 150 });
        } else {
            marker.bindTooltip(popupContent, { direction: 'top', offset: [0, -10] });
        }

        marker.on('click', () => {
            if (isCitadel) console.log(`🏯 Citadel Sync Check | ID: ${poi.id} | Coords: ${poi.lat}, ${poi.lng}`);

            const interactionRadius = gameState.player.interactionRadius || 25;
            if (getDistance(gameState.player.position.lat, gameState.player.position.lng, poi.lat, poi.lng) <= interactionRadius) {
                if (isVault) {
                    if (window.showVaultDialog) window.showVaultDialog(poi);
                    else showNotification("Vault dialog not found", "error");
                }
                else if (isCastle) showCastleDialog(poi);
                else showShopMenu(poi);
            } else {
                showNotification(`Too far away! Get closer to ${isVault ? 'the chest' : (isCastle ? 'attack' : 'trade')}.`, 'warning');
            }
        });

        // EXCLUDE Citadels from Clustering to ensure persistence/clarity
        if (isCitadel) {
            marker.addTo(map);
        } else if (poiCluster) {
            poiCluster.addLayer(marker);
        } else {
            marker.addTo(map);
        }

        poiMarkers.push(marker);
    });
}

export function showCastleDialog(castle) {
    const castleLevel = castle.level || 1;
    let dialog = document.getElementById('poi-dialog');
    if (!dialog) {
        dialog = document.createElement('div');
        dialog.id = 'poi-dialog';
        dialog.className = 'fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm';
        document.body.appendChild(dialog);
    }

    const ownerName = castle.ownerName;
    const isCaptured = !!ownerName;
    const isMine = isCaptured && castle.ownerId === window._currentUserId;

    let ownerText = isMine ? `<p class="text-blue-400 text-xs font-bold mb-4">⭐ This is YOUR castle</p>` :
        (isCaptured ? `<p class="text-red-400 text-xs font-bold mb-4">🚩 Captured by ${ownerName}</p>` :
            '<p class="text-gray-500 text-xs mb-4">Unclaimed Territory</p>');

    let buttonText = '⚔️ Siege Abandoned Castle';
    let buttonClass = 'bg-red-700 hover:bg-red-600';
    let timeInfo = '';

    if (isMine) {
        ownerText = `<p class="text-blue-400 text-xs font-bold mb-4 animate-pulse">⭐ YOU ARE OCCUPYING THIS CASTLE</p>`;
        timeInfo = `<p class="text-[9px] text-blue-300 mt-2">Stay within the circle to receive rewards</p>`;
        buttonText = '🏰 Already Occupied';
        buttonClass = 'bg-blue-600/50 cursor-default pointer-events-none';
    } else if (isCaptured) {
        buttonText = '⚔️ Siege Occupied Castle';
        buttonClass = 'bg-purple-800 hover:bg-purple-700';
    }

    dialog.innerHTML = `
        <div class="menu-panel rounded-2xl p-6 w-full max-w-sm text-center border-2 ${isMine ? 'border-blue-500' : (isCaptured ? 'border-red-600/50' : 'border-yellow-600/50')} bg-gray-900">
            <div class="text-6xl mb-4 filter drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]">🏰</div>
            <h2 class="text-xl font-bold mb-1 text-yellow-500">${castle.name}</h2>
            ${ownerText}
            ${timeInfo}
            <p class="text-gray-400 my-4 text-[10px] uppercase tracking-widest font-bold">Defense Level: ${castleLevel}</p>
            
            <div class="bg-black/40 rounded-xl p-4 mb-6 text-left border border-gray-800">
                <p class="text-xs text-yellow-400 font-bold mb-1 uppercase">Castle Guard:</p>
                <p class="text-sm">🛡️ Guardian (Lv.${castleLevel})</p>
                <div class="h-[1px] bg-gray-800 my-2"></div>
                <p class="text-xs text-gray-400">Occupation Reward: <span class="text-yellow-500 font-bold">brings ${castleLevel * 50} 💰 every hour</span></p>
                <p class="text-[9px] text-gray-500 mt-1 italic">* Reward only given while staying in the zone.</p>
            </div>

            <div class="flex flex-col gap-3">
                <button id="attack-castle-btn" class="py-4 ${buttonClass} rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg transition-all">${buttonText}</button>
                <button onclick="document.getElementById('poi-dialog').classList.add('hidden')" class="py-3 text-gray-400 hover:text-white uppercase text-[10px] font-bold">Leave</button>
            </div>
        </div>
    `;

    dialog.classList.remove('hidden');

    document.getElementById('attack-castle-btn').onclick = async () => {
        // No action needed if already mine (button is disabled)
        dialog.classList.add('hidden');
        const guard = {
            id: 'guard_' + castle.id,
            name: 'Castle Guardian',
            icon: '🛡️',
            class: 'champion',
            level: castleLevel,
            maxHp: 50 + (castleLevel * 20),
            hp: 50 + (castleLevel * 20),
            damage: 5 + (castleLevel * 3),
            defense: castleLevel * 2,
            xpReward: castleLevel * 50,
            goldReward: castleLevel * 20,
            isCastleGuard: true,
            castleId: castle.id,
            castleName: castle.name,
            lat: castle.lat,
            lng: castle.lng
        };
        if (window.startCombat) window.startCombat(guard, true);
    };
}

export function showShopMenu(shop) {
    let dialog = document.getElementById('poi-dialog');
    if (!dialog) {
        dialog = document.createElement('div');
        dialog.id = 'poi-dialog';
        dialog.className = 'fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm';
        document.body.appendChild(dialog);
    }

    const itemsToSell = ['healthPotion', 'largeHealthPotion', 'ironHelmet', 'leatherArmor', 'ironSword'];

    dialog.innerHTML = `
        <div class="menu-panel rounded-2xl p-6 w-full max-w-md border-2 border-purple-500/30 bg-gray-900">
            <div class="text-center mb-6">
                <div class="text-6xl mb-2 filter drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]">🛒</div>
                <h2 class="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-500">${shop.name}</h2>
                <div class="text-xs text-gray-400 mt-1">Trading Post</div>
            </div>
            
            <div class="space-y-2 mb-6 max-h-80 overflow-y-auto pr-1" id="shop-items">
                ${itemsToSell.map(id => {
        const item = ITEMS_DB[id];
        if (!item) return '';
        const price = (item.rarity === 'common' ? 20 : item.rarity === 'uncommon' ? 50 : 150);
        return `
                        <div class="flex items-center justify-between p-3 bg-gray-900/50 rounded-xl border border-gray-800 hover:border-purple-500/50 transition-colors group relative"
                             onmousedown="window.showItemPreview(event, '${id}')" 
                             onmouseup="window.hideItemPreview()" 
                             onmouseleave="window.hideItemPreview()"
                             ontouchstart="window.showItemPreview(event, '${id}')"
                             ontouchend="window.hideItemPreview()">
                            <div class="flex items-center gap-3">
                                <div class="relative">
                                    <span class="text-3xl group-hover:scale-110 transition-transform block">${item.icon}</span>
                                    <div class="absolute -top-1 -right-1 w-2 h-2 bg-purple-500 rounded-full animate-ping opacity-75"></div>
                                </div>
                                <div>
                                    <p class="text-xs font-bold text-white uppercase">${item.name}</p>
                                    <p class="text-[10px] text-yellow-500 font-bold">💰 ${price} Gold</p>
                                </div>
                            </div>
                            <button onclick="window.buyItem('${id}', ${price})" class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg shadow-purple-900/20">Buy</button>
                        </div>
                    `;
    }).join('')}
            </div>

            <button onclick="document.getElementById('poi-dialog').classList.add('hidden')" class="w-full py-3 bg-gray-800 hover:bg-gray-700 rounded-xl font-bold uppercase text-xs text-gray-400">Exit Shop</button>
        </div>
    `;

    dialog.classList.remove('hidden');
}

window.showItemPreview = (event, itemId) => {
    const item = ITEMS_DB[itemId];
    if (!item) return;

    let tooltip = document.getElementById('item-preview-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'item-preview-tooltip';
        tooltip.className = 'item-preview-tooltip';
        document.body.appendChild(tooltip);
    }

    const statsHtml = Object.entries(item.stats || {}).map(([stat, val]) => `
        <div class="stat-row">
            <span class="capitalize">${stat.replace('Bonus', '')}:</span>
            <span class="text-white font-bold">+${val}</span>
        </div>
    `).join('');

    const reqHtml = Object.entries(item.requirements || {}).map(([stat, val]) => {
        const playerVal = gameState.player[stat] || 0;
        const color = playerVal >= val ? 'text-green-400' : 'text-red-400';
        return `<div class="text-[9px] ${color} mt-1">Requires ${val} ${stat}</div>`;
    }).join('');

    tooltip.innerHTML = `
        <div class="flex items-center gap-2 mb-2">
            <span class="text-2xl">${item.icon}</span>
            <h3 class="font-bold text-purple-300 uppercase leading-tight">${item.name}</h3>
        </div>
        <div class="space-y-1">
            ${statsHtml}
        </div>
        ${reqHtml}
        ${item.desc ? `<div class="desc">${item.desc}</div>` : ''}
    `;

    // Position tooltip above the touch/click point
    const x = event.touches ? event.touches[0].clientX : event.clientX;
    const y = event.touches ? event.touches[0].clientY : event.clientY;

    tooltip.style.left = `${Math.max(10, Math.min(window.innerWidth - 210, x - 100))}px`;
    tooltip.style.top = `${y - tooltip.offsetHeight - 20}px`;
    tooltip.classList.remove('hidden');
};

window.hideItemPreview = () => {
    const tooltip = document.getElementById('item-preview-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
};

window.buyItem = (itemId, price) => {
    if (gameState.player.gold < price) {
        showNotification("❌ Not enough gold!", "error");
        return;
    }

    gameState.player.gold -= price;
    const invItem = gameState.inventory.find(i => i.id === itemId);
    if (invItem) invItem.quantity++;
    else gameState.inventory.push({ id: itemId, quantity: 1 });

    showNotification(`✅ Purchased: ${ITEMS_DB[itemId].name}`, "success");
    updateHUD();
    saveGame();
};

export function processIncome() {
    const now = Date.now();
    const interactionRadius = gameState.player.interactionRadius || 25;
    const playerPos = gameState.player.position;

    // Initialize list if missing
    if (!gameState.player.capturedCastles) gameState.player.capturedCastles = [];

    // REAL-TIME OCCUPANCY CHECK & ABANDON LOGIC
    const activeCastles = [];
    let abandonedAny = false;

    gameState.player.capturedCastles.forEach(castle => {
        // Correct distance check using lat/lng stored in the castle object
        const dist = getDistance(playerPos.lat, playerPos.lng, castle.lat, castle.lng);

        if (dist > interactionRadius) {
            console.log(`🏃 Left castle zone of ${castle.name}. Relinquishing control...`);
            abandonedAny = true;
            import('./firebase-service.js').then(({ abandonCastle }) => {
                abandonCastle(castle.id);
            });
            showNotification(`🏳️ Relinquished ${castle.name} (Out of range)`, 'warning');
            addEventLog(`Lost control of ${castle.name} after leaving the zone.`, 'move');
        } else {
            activeCastles.push(castle);
        }
    });

    if (abandonedAny) {
        gameState.player.capturedCastles = activeCastles;
        saveGame();
        renderPOIs(); // Update map markers immediately
    }

    // INCOME TRACKER UI UPDATE
    const tracker = document.getElementById('income-tracker');
    const hasCastles = gameState.player.capturedCastles.length > 0;

    if (!hasCastles) {
        if (tracker) tracker.classList.add('hidden');
        return;
    }

    if (tracker) tracker.classList.remove('hidden');

    if (!gameState.lastIncomeUpdate) gameState.lastIncomeUpdate = now;

    const elapsed = now - gameState.lastIncomeUpdate;
    const progress = Math.min(100, (elapsed / INCOME_INTERVAL) * 100);
    const remainingMs = Math.max(0, INCOME_INTERVAL - elapsed);

    // Update UI elements
    const progBar = document.getElementById('income-progress');
    const timerText = document.getElementById('income-timer');
    const amountText = document.getElementById('income-amount');

    if (progBar) progBar.style.width = `${progress}%`;

    if (timerText) {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        timerText.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    let totalPotentialIncome = 0;
    gameState.player.capturedCastles.forEach(c => totalPotentialIncome += (c.level || 1) * 50);
    if (amountText) amountText.innerText = `+${totalPotentialIncome} Gold`;

    // INCOME PROCESSING (Hourly check for active occupants)
    if (elapsed >= INCOME_INTERVAL) {
        gameState.player.gold += totalPotentialIncome;
        gameState.lastIncomeUpdate = now;

        showNotification(`💰 Collected ${totalPotentialIncome} Gold from occupied castles!`, "success");
        addEventLog(`💰 [Income] Collected ${totalPotentialIncome} Gold from ${gameState.player.capturedCastles.length} castles.`, 'success');

        updateHUD();
        saveGame();

        // Brief pulse effect on payday
        if (tracker) {
            tracker.classList.add('scale-110');
            setTimeout(() => tracker.classList.remove('scale-110'), 500);
        }
    }
}

// Export for global access
window.showCastleDialog = showCastleDialog;
window.showShopMenu = showShopMenu;
window.processIncome = processIncome;
