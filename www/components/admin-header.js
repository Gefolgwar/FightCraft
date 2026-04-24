import './admin-guard.js';

class AdminHeader extends HTMLElement {
    connectedCallback() {
        const currentPage = this.getAttribute('current-page') || 'map';
        
        const pages = [
            { id: 'map', url: '../map/templates_map.html', icon: 'fa-map-marked-alt', label: 'Map', color: 'blue' },
            { id: 'monsters', url: '../gameplay/gameplay_monsters.html', icon: 'fa-skull', label: 'Monsters', color: 'purple' },
            { id: 'shops', url: '../gameplay/gameplay_shops.html', icon: 'fa-store', label: 'Shops', color: 'blue' },
            { id: 'vaults', url: '../gameplay/gameplay_vaults.html', icon: 'fa-box', label: 'Vaults', color: 'emerald' },
            { id: 'castles', url: '../gameplay/gameplay_castle.html', icon: 'fa-chess-rook', label: 'Castles', color: 'indigo' },
            { id: 'citadels', url: '../gameplay/gameplay_citadels.html', icon: 'fa-mountain-city', label: 'Citadels', color: 'orange' },
            { id: 'leveling', url: '../gameplay/gameplay_leveling.html', icon: 'fa-chart-line', label: 'Leveling', color: 'gray' },
        ];

        const titleMap = {
            'map': { icon: 'fa-map-marked-alt', text: 'Map Templates', colorClass: 'text-blue-400' },
            'monsters': { icon: 'fa-dragon', text: 'Monster Admin', colorClass: 'text-purple-400' },
            'shops': { icon: 'fa-store', text: 'Shop Admin', colorClass: 'text-blue-400' },
            'vaults': { icon: 'fa-box-open', text: 'Vault Admin', colorClass: 'text-emerald-400' },
            'castles': { icon: 'fa-chess-rook', text: 'Castle Admin', colorClass: 'text-indigo-400' },
            'citadels': { icon: 'fa-mountain-city', text: 'Citadel Admin', colorClass: 'text-orange-400' },
            'leveling': { icon: 'fa-chart-line', text: 'Leveling Admin', colorClass: 'text-gray-400' },
        };

        const currentInfo = titleMap[currentPage] || titleMap['map'];

        let navHtml = '';
        pages.forEach(p => {
            if (p.id === currentPage) {
                // Using explicit classes because Tailwind CDN might not parse dynamic template literals properly if they are not explicitly in the HTML
                const bgClasses = {
                    'blue': 'bg-blue-700',
                    'purple': 'bg-purple-700',
                    'emerald': 'bg-emerald-700',
                    'indigo': 'bg-indigo-700',
                    'orange': 'bg-orange-700',
                    'gray': 'bg-gray-700'
                };
                navHtml += `<a href="${p.url}" class="px-3 py-1 ${bgClasses[p.color]} text-white rounded text-sm font-bold shadow-inner">
                    <i class="fas ${p.icon} mr-1"></i> ${p.label}
                </a>`;
            } else {
                navHtml += `<a href="${p.url}" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition text-gray-200">
                    <i class="fas ${p.icon} mr-1"></i> ${p.label}
                </a>`;
            }
        });

        this.innerHTML = `
            <header class="bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center shadow-md z-10 w-full shrink-0">
                <div class="flex items-center gap-4">
                    <h1 class="text-xl font-bold ${currentInfo.colorClass}"><i class="fas ${currentInfo.icon} mr-2"></i>${currentInfo.text}</h1>
                    <nav class="flex gap-2">
                        ${navHtml}
                    </nav>
                </div>
                <div class="flex items-center gap-3">
                    <span id="admin-status" class="text-xs text-gray-400">Checking permissions...</span>
                    <button onclick="window.location.reload()" class="text-gray-400 hover:text-white" title="Refresh">
                        <i class="fas fa-sync"></i>
                    </button>
                </div>
            </header>
        `;
    }
}

customElements.define('admin-header', AdminHeader);
