class AdminGuard extends HTMLElement {
    connectedCallback() {
        // We preserve the 'hidden' class if it was applied initially
        const isHidden = this.hasAttribute('hidden') || this.classList.contains('hidden');
        
        // Define base classes
        const classes = ['absolute', 'inset-0', 'z-50', 'bg-gray-900', 'flex', 'flex-col', 'items-center', 'justify-center'];
        if (isHidden) {
            classes.push('hidden');
        }
        
        // Apply the classes
        this.className = classes.join(' ');
        
        this.innerHTML = `
            <i class="fas fa-lock text-6xl text-red-500 mb-4"></i>
            <h2 class="text-2xl font-bold text-red-400">Admin Access Required</h2>
            <p class="text-gray-400 mt-2 text-center px-4">Please log in as an administrator to access this panel.</p>
            <a href="../core/index.html" class="mt-6 px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-white font-bold">Return to Game</a>
        `;
    }
}

customElements.define('admin-guard', AdminGuard);
