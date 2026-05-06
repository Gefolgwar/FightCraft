/**
 * Game Health & Startup Diagnostics
 * This module checks if the game initialized correctly and helps identify 
 * why some elements might be missing or slow.
 */
import { gameState } from './gameState.js';
import { isAdmin, getCurrentUser } from '../firebase/firebase-service.js';

export function runStartupDiagnostics() {
    console.log('🧪 Running Startup Diagnostics...');
    const results = {
        timestamp: new Date().toISOString(),
        auth: !!getCurrentUser(),
        role: window._roleSynced ? 'Synced' : 'Pending',
        isAdmin: isAdmin(),
        location: !!(gameState.player.position && gameState.player.position.lat),
        map: !!window.L,
        debugEnabled: gameState.debug.enabled,
        uiElements: {
            adminPanel: !!document.getElementById('mp-admin-overlay'),
            loadingScreen: document.getElementById('loading-screen')?.classList.contains('hidden') ? 'Hidden' : 'Visible',
            mapContainer: !!document.getElementById('map')
        }
    };

    console.table(results);

    // Auto-fix attempts
    if (results.isAdmin && results.uiElements.adminPanel && document.getElementById('mp-admin-overlay').classList.contains('hidden')) {
        if (gameState.debug.enabled) {
            console.warn('⚠️ Admin detected but Admin Overlay is hidden. Attempting fix...');
            document.getElementById('mp-admin-overlay').classList.remove('hidden');
        }
    }

    if (!results.location) {
        console.error('❌ Location not acquired. Game might be stuck in Berlin.');
    }

    return results;
}

// Expose to window for manual checks
window.runDiagnostics = runStartupDiagnostics;
