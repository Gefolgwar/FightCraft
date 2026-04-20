import { getUsageStatsFC, clearUsageStatsFC, isAdmin, initFirebase } from './firebase-service.js';
import { AdminBundler } from '../maintenance/admin-bundler.js?v=debug_b7';

let chart = null;
let currentSort = { column: 'timestamp', direction: 'desc' };

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase first
    await initFirebase();

    if (!isAdmin()) {
        document.body.innerHTML = '<div class="glass p-10 m-10 text-center text-red-500 font-bold">⛔ ADMIN ONLY</div>';
        return;
    }
    initDashboard();
    setInterval(updateDashboard, 5000);
});



async function initDashboard() {
    // Show User
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    const auth = getAuth();
    const user = auth.currentUser;
    if (user) {
        document.getElementById('user-display').textContent = user.email || user.uid;
    }

    updateDashboard();

    // Consolidated Button: Clear Logs & Stats
    const btnClearLogs = document.getElementById('btn-clear-logs');
    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', async () => {
            if (confirm('🧹 CLEAR ALL LOGS & STATS?\n\nThis will reset reads/writes counters locally AMD in the Cloud, and clear the log table.')) {
                await clearUsageStatsFC();
                updateDashboard();
                // Force UI update immediately
                document.getElementById('stat-reads').textContent = '0';
                document.getElementById('stat-writes').textContent = '0';
                document.getElementById('log-table-body').innerHTML = '';
            }
        });
    }

    // Wire up Bundle Generator
    const btnBundle = document.getElementById('btn-bundle');
    if (btnBundle) {
        btnBundle.addEventListener('click', () => {
            if (confirm('GENERATE STATIC BUNDLES?\nThis will read ALL collections (High Cost) and upload them to Storage.')) {
                AdminBundler.generateAllBundles();
            }
        });
    }

    document.getElementById('btn-refresh').addEventListener('click', updateDashboard);
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            currentSort.direction = currentSort.column === th.dataset.sort ? (currentSort.direction === 'asc' ? 'desc' : 'asc') : 'desc';
            currentSort.column = th.dataset.sort;
            updateTable();
        });
    });
}

function updateDashboard() {
    const stats = getUsageStatsFC();
    document.getElementById('current-date').textContent = stats.date || new Date().toDateString();

    // Stats
    const totalWrites = stats.writes + (stats.deletes || 0);

    // [NEW] Use the wrapper's global counter if available
    const monitoredReads = parseInt(localStorage.getItem('total_firestore_reads') || '0', 10);
    if (monitoredReads > stats.reads) {
        stats.reads = monitoredReads;
    }

    document.getElementById('stat-reads').textContent = stats.reads.toLocaleString();
    document.getElementById('stat-writes').textContent = totalWrites.toLocaleString();
    document.getElementById('stat-rtdb').textContent = stats.rtdb.toLocaleString();

    // Quotas
    const READ_LIMIT = 50000;
    const WRITE_LIMIT = 20000;
    const readP = Math.min((stats.reads / READ_LIMIT) * 100, 100);
    const writeP = Math.min((totalWrites / WRITE_LIMIT) * 100, 100);

    document.getElementById('reads-percent').textContent = `${readP.toFixed(1)}%`;
    document.getElementById('reads-bar').style.width = `${readP}%`;
    document.getElementById('writes-percent').textContent = `${writeP.toFixed(1)}%`;
    document.getElementById('writes-bar').style.width = `${writeP}%`;

    // High usage styling
    if (readP > 80) document.getElementById('reads-bar').classList.add('bg-orange-500');
    if (writeP > 80) document.getElementById('writes-bar').classList.add('bg-orange-500');

    // Calculate hourly reads from detailed logs
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let hourlyReads = 0;

    // Count from detailed monitor logs
    try {
        const detailedLogs = localStorage.getItem('firestore_detailed_logs');
        if (detailedLogs) {
            const parsed = JSON.parse(detailedLogs);
            hourlyReads = parsed
                .filter(log => log.timestamp >= oneHourAgo && log.type === 'READ')
                .reduce((sum, log) => sum + (log.size || 0), 0);
        }
    } catch (e) {
        console.warn('Failed to calculate hourly reads:', e);
    }

    // Add from old tracking logs too
    hourlyReads += stats.logs
        .filter(log => log.timestamp >= oneHourAgo && log.type === 'READ')
        .reduce((sum, log) => sum + (log.size || 0), 0);

    document.getElementById('stat-hour-reads').textContent = hourlyReads.toLocaleString();


    updateChart(stats.logs);
    updateTopConsuming(stats.logs);
    updateTable();
}

function updateTopConsuming(logs) {
    const agg = {};
    logs.forEach(l => {
        const key = `${l.type}: ${l.path}`;
        if (!agg[key]) agg[key] = { count: 0, desc: {} };
        agg[key].count += l.size;

        // Extract category or main part of description
        const cleanDesc = (l.description || '').split(' (')[0].split(' - ')[0];
        agg[key].desc[cleanDesc] = (agg[key].desc[cleanDesc] || 0) + 1;
    });

    const sorted = Object.entries(agg).sort((a, b) => b[1].count - a[1].count).slice(0, 10);

    document.getElementById('top-queries-body').innerHTML = sorted.map(([key, data]) => {
        const [type, path] = key.split(': ');
        // Get most frequent description
        const bestDesc = Object.entries(data.desc).sort((a, b) => b[1] - a[1])[0][0] || '-';

        return `
            <tr class="border-b border-gray-800/50">
                <td class="py-2 truncate max-w-[120px]" title="${path}">
                    <span class="font-bold border-b border-white/20 mr-1">${type}</span> ${path}
                </td>
                <td class="py-2 text-[10px] text-gray-400 opacity-80 truncate max-w-[100px]" title="${bestDesc}">
                    ${bestDesc}
                </td>
                <td class="text-right font-mono py-2">${data.count}</td>
            </tr>`;
    }).join('');
}

function updateChart(logs) {
    const ctx = document.getElementById('usageChart');
    if (!ctx) return;
    const now = Date.now();
    const range = 10 * 60 * 1000; // 10 mins
    const buckets = Array(10).fill(0).map((_, i) => ({ time: now - i * 60000, r: 0, w: 0 }));

    logs.forEach(l => {
        const idx = Math.floor((now - l.timestamp) / 60000);
        if (idx >= 0 && idx < 10) {
            if (l.type === 'READ') buckets[idx].r += l.size;
            else buckets[idx].w += l.size;
        }
    });

    const labels = buckets.map(b => new Date(b.time).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })).reverse();
    const dataR = buckets.map(b => b.r).reverse();
    const dataW = buckets.map(b => b.w).reverse();

    if (chart) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = dataR;
        chart.data.datasets[1].data = dataW;
        chart.update('none');
    } else {
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels, datasets: [
                    { label: 'Reads', data: dataR, borderColor: '#60a5fa', tension: 0.3 },
                    { label: 'Writes', data: dataW, borderColor: '#f87171', tension: 0.3 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    }
}

const SCHEMA_MAP = {
    'users': 'Профіль гравця / Роль / Позиція',
    'characters': 'Персонаж: Інвентар / Статти / XP',
    'spawned_objects': 'Об\'єкти світу: Монстри / Замки / Магазини',
    'templates': 'Адмін-шаблони об\'єктів',
    'world_snapshots': 'Резервні копії станів світу',
    'city_zones': 'Межі міст (GeoJSON)',
    'groups': 'Групи гравців (Party)',
    'castles': 'Стан замків (власники)'
};

function getPathDescription(path) {
    if (!path || path === 'N/A') return 'Невідомий шлях';
    if (path.startsWith('[Group Query]')) return 'Запит по всіх колекціях персонажів';

    const parts = path.split('/');
    const root = parts[0];

    if (root === 'users') {
        if (parts.length >= 4 && parts[2] === 'characters') return SCHEMA_MAP['characters'];
        return SCHEMA_MAP['users'];
    }

    return SCHEMA_MAP[root] || 'Документ бази даних';
}

function updateTable() {
    const stats = getUsageStatsFC();

    // Merge logs from both sources
    let allLogs = [...stats.logs];

    // Add logs from firebase-monitor.js
    try {
        const detailedLogs = localStorage.getItem('firestore_detailed_logs');
        if (detailedLogs) {
            const parsed = JSON.parse(detailedLogs);
            allLogs = allLogs.concat(parsed);
        }
    } catch (e) {
        console.warn('Failed to load detailed logs:', e);
    }

    // Sort by timestamp desc
    const logs = allLogs.sort((a, b) => {
        const valA = a[currentSort.column] || a.timestamp;
        const valB = b[currentSort.column] || b.timestamp;
        return currentSort.direction === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    document.getElementById('log-table-body').innerHTML = logs.slice(0, 50).map(l => {
        const pathDesc = getPathDescription(l.path);
        const tooltip = `${l.path}\n---\n${pathDesc}`;

        return `
        <tr class="text-xs border-b border-gray-800 hover:bg-white/5 transition">
            <td class="p-3 font-mono opacity-50">${new Date(l.timestamp).toLocaleTimeString()}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded ${l.type === 'READ' ? 'bg-blue-900/40 text-blue-300' : 'bg-red-900/40 text-red-300'}">${l.type}</span></td>
            <td class="p-3 font-mono text-blue-400 truncate max-w-[150px]" title="${tooltip}">${l.path}</td>
            <td class="p-3 font-bold">${l.size}</td>
            <td class="p-3 font-mono text-[10px] opacity-60 truncate max-w-[200px]" title='${l.data || ""}'>${l.data || "-"}</td>
            <td class="p-3 opacity-70">${l.description}</td>
        </tr>
    `;
    }).join('');
}
