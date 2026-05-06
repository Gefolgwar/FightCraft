// Character Selection Module
import { initFirebase, getCurrentUser } from '../firebase/firebase-service.js';
import { showNotification, addEventLog } from './ui-controller.js';

let selectedAvatar = '🧙'; // Default avatar
let currentUserId = null;
let _initInProgress = null;

/**
 * Initialize character selection system
 */
export async function initCharacterSelection() {
    if (_initInProgress) return _initInProgress;

    _initInProgress = _doInitCharacterSelection();
    try {
        return await _initInProgress;
    } finally {
        _initInProgress = null;
    }
}

async function _doInitCharacterSelection() {
    console.log('🎭 Initializing character selection...');

    // Wait for Firebase auth
    const success = await initFirebase();
    if (!success) {
        showCharError('Failed to connect to server');
        return null;
    }

    // Get current Firebase user
    const user = getCurrentUser();
    if (!user) {
        showCharError('Authentication failed');
        return null;
    }

    currentUserId = user.uid;
    console.log('👤 User ID:', currentUserId.substring(0, 12) + '...');

    // Check localStorage for last selected character
    const lastCharId = localStorage.getItem('selectedCharacterId');

    if (lastCharId) {
        console.log('🔍 Found saved character:', lastCharId);
        // Try to load that character
        const charData = await loadCharacterData(lastCharId);

        if (charData) {
            console.log('✅ Auto-loading character:', charData.player.name);
            return { characterId: lastCharId, data: charData };
        } else {
            console.warn('⚠️ Saved character not found (or access denied), clearing selection.');
            localStorage.removeItem('selectedCharacterId');
        }
    }

    // Show character selection screen
    await showCharacterSelection();
    return null; // Will return character after user selects
}

/**
 * Show character selection UI
 */
async function showCharacterSelection() {
    // Load UI from external file
    await loadCharacterSelectionUI();

    const screen = document.getElementById('character-selection-screen');
    if (!screen) {
        console.error('❌ Character selection UI not found!');
        return;
    }

    screen.classList.remove('hidden');

    // FORCE HIDE MAIN LOADING SCREEN
    const mainLoading = document.getElementById('loading-screen');
    if (mainLoading) mainLoading.classList.add('hidden');

    // Load characters
    await loadCharactersList();
}

/**
 * Load character selection UI into page
 */
async function loadCharacterSelectionUI() {
    // Inject character selection UI into body
    const response = await fetch('../auth-ui/character-selection-ui.html');
    const html = await response.text();

    // Create temp div to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Insert character selection screen as first child of body
    const charScreen = temp.querySelector('#character-selection-screen');
    const mpPanel = temp.querySelector('#multiplayer-panel');

    if (charScreen) {
        document.body.insertBefore(charScreen, document.body.firstChild);
    }

    if (mpPanel) {
        // Add multiplayer panel to game container
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.appendChild(mpPanel);
        }
    }
}

/**
 * Load list of characters for current user
 */
async function loadCharactersList() {
    const { getAllCharacters } = await import('../firebase/firebase-service.js');

    const loading = document.getElementById('char-loading');
    const list = document.getElementById('char-list');
    const createSection = document.getElementById('char-create-section');

    try {
        console.log(`📥 Loading characters for user: ${currentUserId}`);
        const characters = await getAllCharacters(currentUserId);

        console.log(`📄 Retrieved ${characters.length} characters`);

        loading.classList.add('hidden');
        createSection.classList.remove('hidden');

        // Filter out test players (isTestPlayer: true)
        const realCharacters = characters.filter(char => !char.data.isTestPlayer);

        if (realCharacters.length === 0) {
            // No real characters, show create form immediately
            list.classList.add('hidden');
            showCreateCharacterForm();
            return;
        }

        // Show character list
        list.classList.remove('hidden');
        list.innerHTML = '';

        realCharacters.forEach(char => {
            const div = document.createElement('div');
            div.className = 'menu-panel rounded-xl p-4 cursor-pointer hover:bg-purple-900/30 transition';
            div.onclick = () => selectCharacter(char.id, char.data);

            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="text-4xl">${char.data.player.avatar || '🧙'}</div>
                    <div class="flex-1">
                        <h3 class="font-bold">${char.data.player.name}</h3>
                        <p class="text-sm text-gray-400">Level ${char.data.player.level} • ${char.data.player.gold} gold</p>
                    </div>
                    <button onclick="deleteCharacter('${char.id}', event)" class="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs">
                        🗑️
                    </button>
                </div>
            `;

            list.appendChild(div);
        });

    } catch (error) {
        console.error('Error loading characters:', error);
        showCharError('Failed to load characters');
        loading.classList.add('hidden');
        createSection.classList.remove('hidden');
    }
}

/**
 * Select a character and start game
 */
async function selectCharacter(characterId, characterData) {
    console.log('✅ Selected character:', characterData.player.name);

    // Save to localStorage
    localStorage.setItem('selectedCharacterId', characterId);

    // Hide character selection
    const screen = document.getElementById('character-selection-screen');
    if (screen) screen.classList.add('hidden');

    // Trigger game start with this character
    if (window.startGameWithCharacter) {
        window.startGameWithCharacter(characterId, characterData);
    }
}

/**
 * Show create character form
 */
window.showCreateCharacterForm = function () {
    document.getElementById('show-create-btn').classList.add('hidden');
    document.getElementById('char-create-form').classList.remove('hidden');

    const input = document.getElementById('char-name-input');
    if (input) {
        // Pre-fill with User Nickname
        const user = getCurrentUser();
        if (user && user.displayName) {
            input.value = user.displayName;
        }
        input.focus();
    }
};

/**
 * Hide create character form
 */
window.hideCreateCharacterForm = function () {
    document.getElementById('show-create-btn').classList.remove('hidden');
    document.getElementById('char-create-form').classList.add('hidden');
    document.getElementById('char-name-input').value = '';
};

/**
 * Select avatar
 */
window.selectAvatar = function (avatar) {
    selectedAvatar = avatar;

    // Update UI
    document.querySelectorAll('.avatar-btn').forEach(btn => {
        btn.classList.remove('border-purple-500');
        btn.classList.add('border-transparent');
    });

    const btn = document.querySelector(`[data-avatar="${avatar}"]`);
    if (btn) {
        btn.classList.remove('border-transparent');
        btn.classList.add('border-purple-500');
    }
};

/**
 * Create new character
 */
window.createNewCharacter = async function () {
    const nameInput = document.getElementById('char-name-input');
    const name = nameInput.value.trim();

    if (!name) {
        showCharError('Please enter a character name');
        return;
    }

    if (name.length < 3) {
        showCharError('Name must be at least 3 characters');
        return;
    }

    try {
        const { createCharacter } = await import('../firebase/firebase-service.js');

        showNotification('Creating character...', 'info');

        const { characterId, characterData } = await createCharacter(currentUserId, name, selectedAvatar);

        console.log('✅ Character created:', characterId);
        showNotification(`Character "${name}" created!`, 'success');

        // Select this character
        await selectCharacter(characterId, characterData);

    } catch (error) {
        console.error('Error creating character:', error);
        showCharError('Failed to create character: ' + error.message);
    }
};

/**
 * Delete character
 */
window.deleteCharacter = async function (characterId, event) {
    if (event) event.stopPropagation();

    if (!confirm('Delete this character? This cannot be undone!')) {
        return;
    }

    try {
        const { deleteCharacter } = await import('../firebase/firebase-service.js');
        await deleteCharacter(currentUserId, characterId);

        showNotification('Character deleted', 'success');

        // Reload list
        await loadCharactersList();

    } catch (error) {
        console.error('Error deleting character:', error);
        showCharError('Failed to delete character');
    }
};

/**
 * Load character data
 */
async function loadCharacterData(characterId) {
    try {
        const { getCharacter } = await import('../firebase/firebase-service.js');
        return await getCharacter(currentUserId, characterId);
    } catch (error) {
        console.error('Error loading character:', error);
        return null;
    }
}

/**
 * Show error message
 */
function showCharError(message) {
    const errorDiv = document.getElementById('char-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        setTimeout(() => errorDiv.classList.add('hidden'), 5000);
    }
}

// Export
export { selectCharacter, loadCharactersList };
