/**
 * Debug Logger for Mobile
 * Intercepts console.log, warn, and error to display in the UI console.
 */

const MAX_LOGS = 100;
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    table: console.table
};

export function initLogger() {
    const consoleContent = document.getElementById('debug-console-content');
    if (!consoleContent) return;

    const addLogToUI = (args, type) => {
        const entry = document.createElement('div');
        entry.className = `border-b border-slate-800/50 pb-1 ${getLogColor(type)}`;

        // Format time
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'text-gray-600 mr-2 text-[8px]';
        timeSpan.textContent = timeStr;
        entry.appendChild(timeSpan);

        let message = '';
        if (type === 'table') {
            const data = args[0];
            if (typeof data === 'object') {
                message = '┌─── Table Data ───\n' +
                    Object.entries(data).map(([k, v]) => {
                        const val = typeof v === 'object' ? JSON.stringify(v) : v;
                        return `│ ${k}: ${val}`;
                    }).join('\n') +
                    '\n└────────────────';
            } else {
                message = String(data);
            }
        } else {
            // Convert arguments to string
            message = args.map(arg => {
                if (typeof arg === 'object') {
                    try { return JSON.stringify(arg); } catch (e) { return '[Complex Object]'; }
                }
                return String(arg);
            }).join(' ');
        }

        const msgSpan = document.createElement('pre'); // Use pre for table formatting
        msgSpan.className = 'whitespace-pre-wrap inline font-mono';
        msgSpan.textContent = message;
        entry.appendChild(msgSpan);

        consoleContent.appendChild(entry);

        // Limit logs
        while (consoleContent.children.length > MAX_LOGS) {
            consoleContent.removeChild(consoleContent.firstChild);
        }

        // Auto-scroll if at bottom
        consoleContent.scrollTop = consoleContent.scrollHeight;
    };

    const getLogColor = (type) => {
        switch (type) {
            case 'warn': return 'text-yellow-500';
            case 'error': return 'text-red-500 font-bold';
            case 'info': return 'text-blue-400';
            default: return 'text-gray-300';
        }
    };

    // Override console methods
    console.log = (...args) => {
        originalConsole.log.apply(console, args);
        addLogToUI(args, 'log');
    };
    console.warn = (...args) => {
        originalConsole.warn.apply(console, args);
        addLogToUI(args, 'warn');
    };
    console.error = (...args) => {
        originalConsole.error.apply(console, args);
        addLogToUI(args, 'error');
    };
    console.info = (...args) => {
        originalConsole.info.apply(console, args);
        addLogToUI(args, 'info');
    };
    console.table = (...args) => {
        originalConsole.table.apply(console, args);
        addLogToUI(args, 'table');
    };

    console.log('🚀 Mobile Logger Initialized');
}

window.toggleDebugConsole = function () {
    const panel = document.getElementById('debug-console-panel');
    if (panel) {
        panel.classList.toggle('hidden');
    }
};

window.clearDebugConsole = function () {
    const content = document.getElementById('debug-console-content');
    if (content) {
        content.innerHTML = '<div class="text-gray-500 italic">-- Console cleared --</div>';
    }
};
