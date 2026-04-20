// Character Selection UI Loader
// Automatically injects character selection UI and multiplayer panel into the page

(async function loadCharacterSelectionUI() {
    console.log('🎭 Loading Character Selection UI...');

    try {
        // Fetch the UI HTML
        const response = await fetch('../auth-ui/character-selection-ui.html');
        if (!response.ok) {
            throw new Error(`Failed to load UI: ${response.statusText}`);
        }

        const html = await response.text();

        // Create temporary container
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Extract character selection screen
        const charScreen = temp.querySelector('#character-selection-screen');
        if (charScreen) {
            // Insert as first child of body (before everything else)
            document.body.insertBefore(charScreen, document.body.firstChild);
            console.log('✅ Character Selection Screen loaded');
        } else {
            console.warn('⚠️ Character Selection Screen not found in UI file');
        }

        // Extract multiplayer panel
        const mpPanel = temp.querySelector('#multiplayer-panel');
        if (mpPanel) {
            // Add to game container
            const gameContainer = document.getElementById('game-container');
            if (gameContainer) {
                gameContainer.appendChild(mpPanel);
                console.log('✅ Multiplayer Panel loaded');
            } else {
                console.warn('⚠️ Game container not found, delaying panel load...');
                // Try again after a short delay
                setTimeout(() => {
                    const container = document.getElementById('game-container');
                    if (container) {
                        container.appendChild(mpPanel);
                        console.log('✅ Multiplayer Panel loaded (delayed)');
                    }
                }, 500);
            }
        } else {
            console.warn('⚠️ Multiplayer Panel not found in UI file');
        }

        console.log('✅ Character Selection UI loaded successfully');

    } catch (error) {
        console.error('❌ Failed to load Character Selection UI:', error);
        console.warn('Game will continue with legacy mode (no character selection)');
    }
})();
