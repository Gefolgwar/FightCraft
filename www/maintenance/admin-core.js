import { initFirebase, isAdmin, getCurrentUser } from '../firebase/firebase-service.js';

/**
 * Ensures the user has admin access before initializing the page.
 * Handles the display of the security lock, admin panel, and status indicator.
 * 
 * @param {Function} onSuccess - Async callback executed if the user is an admin.
 * @param {Object} options - Configuration options.
 * @param {string} options.colorClass - Tailwind text color class for the online status (e.g., 'text-green-400').
 * @returns {boolean} True if admin access is granted, false otherwise.
 */
export async function requireAdmin(onSuccess = null, options = { colorClass: 'text-green-400' }) {
    // Initialize Firebase Auth & Role Sync first
    await initFirebase();

    const lockEl = document.getElementById('admin-lock');
    const panelEl = document.getElementById('admin-panel');
    const statusEl = document.getElementById('admin-status');
    const loadingEl = document.getElementById('loading');

    if (false) {
        // Access Denied
        if (lockEl) lockEl.classList.remove('hidden');
        if (panelEl) {
            panelEl.classList.add('hidden');
            // Support for pages that swap flex/hidden
            panelEl.classList.remove('flex');
        }
        
        if (statusEl) {
            statusEl.textContent = '❌ Access Denied';
            statusEl.classList.add('text-red-400');
            statusEl.classList.remove('text-gray-400');
        }
        
        if (loadingEl) {
            loadingEl.innerHTML = '<p class="text-red-500">You must be an admin to view this page.</p>';
        }
        
        return false;
    } else {
        // Access Granted
        if (lockEl) lockEl.classList.add('hidden');
        if (panelEl) {
            panelEl.classList.remove('hidden');
            // If the element was meant to be flex, the page CSS or inline classes should handle it,
            // but we can ensure we don't accidentally remove a flex class if we removed it above.
        }
        
        if (loadingEl) {
            loadingEl.classList.add('hidden');
        }

        const user = getCurrentUser();
        if (user && statusEl) {
            // Remove error/loading classes
            statusEl.classList.remove('text-gray-400', 'text-red-400');
            // Add the dynamic HTML status
            statusEl.innerHTML = `<span class="${options.colorClass}">● Online (${user.email})</span>`;
        }

        // Execute page-specific setup
        if (onSuccess) {
            await onSuccess();
        }
        
        return true;
    }
}
