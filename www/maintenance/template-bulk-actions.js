/**
 * Shared Bulk Actions module for Admin Template Management.
 * Adds checkbox selection, "Select All", and a floating "Delete Selected" bar.
 * 
 * Usage in any admin-*.js:
 *   import { BulkActions } from './template-bulk-actions.js';
 *   const bulk = new BulkActions(deleteTemplate, () => loadTemplates());
 *   // In renderTemplateList(): bulk.injectSelectAllHeader(list, visibleIds);
 *   // Per card: bulk.createCheckbox(t.id)
 */

export class BulkActions {
    /**
     * @param {Function} deleteFn  - async (id) => bool — deletes one template by ID
     * @param {Function} reloadFn  - async () => void — reloads the template list after bulk op
     */
    constructor(deleteFn, reloadFn) {
        this.selected = new Set();
        this.deleteFn = deleteFn;
        this.reloadFn = reloadFn;
        this._bar = null;
        this._allIds = [];
    }

    // ────────────── PUBLIC API ──────────────

    /** Toggle a single template's selection state */
    toggle(id) {
        if (this.selected.has(id)) {
            this.selected.delete(id);
        } else {
            this.selected.add(id);
        }
        this._updateBar();
        this._syncCheckboxes();
    }

    /** Select or deselect all currently visible templates */
    toggleAll(ids) {
        const allSelected = ids.every(id => this.selected.has(id));
        if (allSelected) {
            ids.forEach(id => this.selected.delete(id));
        } else {
            ids.forEach(id => this.selected.add(id));
        }
        this._updateBar();
        this._syncCheckboxes();
    }

    /** Clear all selections */
    clear() {
        this.selected.clear();
        this._updateBar();
        this._syncCheckboxes();
    }

    /**
     * Inject the "Select All" header row at the top of a template list container.
     * Call this at the START of renderTemplateList(), after clearing innerHTML.
     * @param {HTMLElement} listEl - The #template-list container
     * @param {string[]} visibleIds - IDs of templates currently visible (after search filter)
     */
    injectSelectAllHeader(listEl, visibleIds) {
        this._allIds = visibleIds;

        // Ensure floating bar exists
        this._ensureBar();

        if (visibleIds.length === 0) return;

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 px-2 py-1.5 bg-gray-800/60 rounded border border-gray-700/50 text-xs text-gray-400 select-none';
        header.id = 'bulk-select-all-row';

        const allChecked = visibleIds.every(id => this.selected.has(id));

        header.innerHTML = `
            <label class="flex items-center gap-2 cursor-pointer flex-1">
                <input type="checkbox" id="bulk-select-all" 
                    class="w-3.5 h-3.5 accent-red-500 cursor-pointer"
                    ${allChecked ? 'checked' : ''}>
                <span>Select All (${visibleIds.length})</span>
            </label>
        `;

        header.querySelector('#bulk-select-all').addEventListener('change', () => {
            this.toggleAll(visibleIds);
        });

        listEl.prepend(header);
    }

    /**
     * Create and return a checkbox element for a single template card.
     * Append this INSIDE the card's flex layout.
     * @param {string} id - Template ID
     * @returns {HTMLElement}
     */
    createCheckbox(id) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'bulk-cb w-3.5 h-3.5 accent-red-500 cursor-pointer flex-shrink-0';
        cb.dataset.templateId = id;
        cb.checked = this.selected.has(id);
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(id);
        });
        return cb;
    }

    // ────────────── PRIVATE ──────────────

    /** Create the floating action bar (once) */
    _ensureBar() {
        if (this._bar) return;

        const bar = document.createElement('div');
        bar.id = 'bulk-action-bar';
        bar.className = [
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
            'bg-gray-800 border border-red-500/40 rounded-xl shadow-2xl shadow-red-900/20',
            'px-5 py-3 flex items-center gap-4',
            'transition-all duration-300 ease-out',
            'opacity-0 translate-y-4 pointer-events-none'
        ].join(' ');

        bar.innerHTML = `
            <span class="text-sm text-gray-300">
                <i class="fas fa-check-square text-red-400 mr-1"></i>
                <span id="bulk-count">0</span> selected
            </span>
            <button id="bulk-deselect-btn"
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 transition">
                <i class="fas fa-times mr-1"></i> Clear
            </button>
            <button id="bulk-delete-btn"
                class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-xs text-white font-bold transition flex items-center gap-1">
                <i class="fas fa-trash-alt"></i>
                Delete Selected (<span id="bulk-delete-count">0</span>)
            </button>
        `;

        bar.querySelector('#bulk-deselect-btn').addEventListener('click', () => this.clear());
        bar.querySelector('#bulk-delete-btn').addEventListener('click', () => this._executeBulkDelete());

        document.body.appendChild(bar);
        this._bar = bar;
    }

    /** Show/hide the floating bar and update counts */
    _updateBar() {
        if (!this._bar) return;

        const count = this.selected.size;
        this._bar.querySelector('#bulk-count').textContent = count;
        this._bar.querySelector('#bulk-delete-count').textContent = count;

        if (count > 0) {
            this._bar.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
            this._bar.classList.add('opacity-100', 'translate-y-0', 'pointer-events-auto');
        } else {
            this._bar.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
            this._bar.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
        }
    }

    /** Sync all visible checkboxes with internal state */
    _syncCheckboxes() {
        document.querySelectorAll('.bulk-cb').forEach(cb => {
            cb.checked = this.selected.has(cb.dataset.templateId);
        });

        const selectAllCb = document.getElementById('bulk-select-all');
        if (selectAllCb && this._allIds.length > 0) {
            selectAllCb.checked = this._allIds.every(id => this.selected.has(id));
        }
    }

    /** Execute the bulk delete with confirmation */
    async _executeBulkDelete() {
        const count = this.selected.size;
        if (count === 0) return;

        const confirmed = confirm(`⚠️ Delete ${count} template${count > 1 ? 's' : ''}?\n\nThis action cannot be undone.`);
        if (!confirmed) return;

        const ids = [...this.selected];
        let deleted = 0;
        let failed = 0;

        for (const id of ids) {
            try {
                await this.deleteFn(id);
                deleted++;
            } catch (e) {
                console.error(`Failed to delete template ${id}:`, e);
                failed++;
            }
        }

        this.selected.clear();
        this._updateBar();

        // Notify user
        const msg = failed > 0
            ? `Deleted ${deleted}/${count} templates. ${failed} failed.`
            : `✅ Deleted ${deleted} template${deleted > 1 ? 's' : ''}.`;
        
        if (window.logConsole) {
            window.logConsole(msg);
        }

        // Reload the list
        await this.reloadFn();
    }
}
