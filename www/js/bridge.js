import { openMenu, closeMenu, toggleSetting, showNotification, addEventLog, updateCharacterPanel, allocateStat, handleEquipSlot, showItemDetails, equipItem, useItem, closeItemModal, filterInventory, toggleEventLog, clearEventLog } from './ui-controller.js';
import { selectAttackZone, selectDefense, executeAttack, fleeCombat, closeVictory, closeDefeat, startCombat } from './combat.js';
import { centerOnPlayer, updatePlayerPosition, getDistance, updateOtherPlayers } from './map.js';
import { resetGame, saveGame, updateQuestProgress } from './app.js';
import { recalculateStats } from './gameState.js';

// Export all functions to window
window.openMenu = openMenu;
window.closeMenu = closeMenu;
window.toggleSetting = toggleSetting;
window.showNotification = showNotification;
window.addEventLog = addEventLog;
window.updateCharacterPanel = updateCharacterPanel;
window.allocateStat = allocateStat;
window.handleEquipSlot = handleEquipSlot;
window.showItemDetails = showItemDetails;
window.equipItem = equipItem;
window.useItem = useItem;
window.closeItemModal = closeItemModal;
window.filterInventory = filterInventory;
window.toggleEventLog = toggleEventLog;
window.clearEventLog = clearEventLog;

window.selectAttackZone = selectAttackZone;
window.selectDefense = selectDefense;
window.executeAttack = executeAttack;
window.fleeCombat = fleeCombat;
window.closeVictory = closeVictory;
window.closeDefeat = closeDefeat;
window.startCombat = startCombat;

window.centerOnPlayer = centerOnPlayer;
window.updatePlayerPosition = updatePlayerPosition;
window.getDistance = getDistance;
window.updateOtherPlayers = updateOtherPlayers;

window.resetGame = resetGame;
window.saveGame = saveGame;
window.getPlayerStats = recalculateStats;
window.updateQuestProgress = updateQuestProgress;

console.log('✅ Global bridge loaded - all functions available');
