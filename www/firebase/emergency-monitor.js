(function () {
    console.log('%c🚨 EMERGENCY FIRESTORE MONITOR ACTIVATED', 'background: red; color: white; font-size: 14px; padding: 4px;');

    // =========================================================================
    // 1. STATE & STORAGE
    // =========================================================================
    const STORAGE_KEY = 'total_firestore_reads_emergency';
    const SESSION_KEY = 'session_firestore_reads';

    // Initialize session counters
    let sessionReads = 0;
    let recentUrls = []; // For loop detection
    let readsPerMinute = 0;
    const readsHistory = []; // Timestamps of reads in last 60s

    // Get persisted total
    let totalReads = parseInt(localStorage.getItem('total_firestore_reads') || '0', 10);

    function incrementReads(count = 1, url = 'unknown') {
        if (count === 0) return;

        sessionReads += count;
        totalReads += count;

        // Persist to shared storage (compatibility with db-usage.html)
        localStorage.setItem('total_firestore_reads', totalReads);

        // Track RPM
        const now = Date.now();
        readsHistory.push(now);
        // Clean old history > 60s
        while (readsHistory.length > 0 && readsHistory[0] < now - 60000) {
            readsHistory.shift();
        }
        readsPerMinute = readsHistory.length;

        updateOverlay(url);
    }

    // =========================================================================
    // 2. NETWORK INTERCEPTOR (Fetch & XHR)
    // =========================================================================
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest;

    // --- INTERCEPT FETCH ---
    window.fetch = async function (...args) {
        const url = args[0] ? args[0].toString() : '';

        if (isFirestoreUrl(url)) {
            detectLoop(url);
            console.log(`%c📡 FIRESTORE FETCH: ${getShortPath(url)}`, 'color: orange; font-weight: bold;');
            incrementReads(1, getShortPath(url));
        }

        return originalFetch.apply(this, args);
    };

    // --- INTERCEPT XHR (The secret sauce for WebChannel) ---
    const XHRProxy = function () {
        const xhr = new originalXHR();
        let requestUrl = '';

        const originalOpen = xhr.open;
        xhr.open = function (method, url, ...rest) {
            requestUrl = url || '';
            return originalOpen.apply(this, [method, url, ...rest]);
        };

        const originalSend = xhr.send;
        xhr.send = function (body) {
            if (isFirestoreUrl(requestUrl)) {

                // Firestore WebChannel "Listen" often keeps one connection open
                // But creates new XHRs for handshake/connect.
                // We count the INITIATION of a connection as a "Network Op"
                // Counting exact 'reads' from encrypted/protobuf stream here is hard without a parser,
                // BUT we can detect the 'Listen' intent.

                const isListen = requestUrl.includes('Listen') || requestUrl.includes('channel');
                detectLoop(requestUrl);

                const label = isListen ? '🌊 STREAM (Listen)' : '📦 REST/RPC';
                console.log(`%c📡 FIRESTORE XHR: ${label} - ${getShortPath(requestUrl)}`, 'color: yellow; background: #333; padding: 2px;');

                // We count 1 for the request. 
                // Note: The stream will deliver many docs, but we can't parse them easily here 
                // without decoding the proto/json numeric stream.
                // However, seeing MANY of these requests is the red flag for loops.
                incrementReads(1, getShortPath(requestUrl));
            }
            return originalSend.apply(this, [body]);
        };

        return xhr;
    };

    // Copy prototype and statics to ensure libraries still work
    XHRProxy.prototype = originalXHR.prototype;
    Object.keys(originalXHR).forEach(key => XHRProxy[key] = originalXHR[key]);
    window.XMLHttpRequest = XHRProxy;

    // --- UTILS ---
    function isFirestoreUrl(url) {
        return url && url.includes && (
            url.includes('firestore.googleapis.com') ||
            url.includes('google.firestore.v1.Firestore')
        );
    }

    function getShortPath(url) {
        try {
            if (!url) return 'N/A';
            // Extract roughly the method or collection info if visible
            if (url.includes('Identify')) return 'Auth/Identify';
            if (url.includes('Listen')) return 'Listen/Stream';
            if (url.includes('Write')) return 'Write';
            const parts = url.split('/');
            return parts[parts.length - 1].split('?')[0].substr(0, 30);
        } catch (e) { return 'url-parse-error'; }
    }

    // =========================================================================
    // 3. LOOP DETECTOR
    // =========================================================================
    const loopBuffer = []; // { url, time }

    function detectLoop(url) {
        const now = Date.now();
        // Add to buffer
        loopBuffer.push({ url, time: now });

        // Clean old
        while (loopBuffer.length > 0 && loopBuffer[0].time < now - 1000) {
            loopBuffer.shift();
        }

        // Check duplicates in last second
        const count = loopBuffer.filter(i => i.url === url).length;
        if (count > 3) {
            console.warn(`%c🚨 LOOP DETECTED (${count}/sec): ${getShortPath(url)}`, 'background: red; color: white; font-size: 16px; font-weight: bold;');
            showFlashAlert(`LOOP: ${getShortPath(url)}`);
        }
    }

    function showFlashAlert(msg) {
        const flash = document.createElement('div');
        flash.style = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                       background: red; color: white; font-size: 30px; font-weight: bold; 
                       padding: 20px; z-index: 10000; border: 5px solid yellow; pointer-events: none;
                       box-shadow: 0 0 50px rgba(255,0,0,0.5); text-align: center;`;

        // Add overlay text specifically mentioning local vs cloud mismatch
        flash.innerHTML = `⚠️ ${msg}<br><span style="font-size:14px">Check WebChannel/Stream Logic</span>`;

        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 2000);
    }

    // =========================================================================
    // 4. VISUAL OVERLAY UI
    // =========================================================================
    const overlay = document.createElement('div');
    overlay.id = 'firestore-emergency-monitor';
    overlay.style = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.85);
        border: 2px solid #ef4444;
        color: #fff;
        font-family: monospace;
        padding: 10px;
        z-index: 9999;
        border-radius: 8px;
        font-size: 11px;
        min-width: 200px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        pointer-events: none; /* Let clicks pass through */
        user-select: none;
    `;

    // Initial HTML
    overlay.innerHTML = `
        <div style="border-bottom: 1px solid #444; padding-bottom: 4px; margin-bottom: 4px; font-weight: bold; color: #ef4444;">
         🔥 WRAPPED MONITOR
        </div>
        <div style="display: flex; justify-content: space-between;">
            <span style="color: #9ca3af;">Session:</span>
            <span id="em-session" style="color: #60a5fa; font-weight: bold;">0</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
            <span style="color: #9ca3af;">Total (LS):</span>
            <span id="em-total" style="color: #34d399; font-weight: bold;">0</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
            <span style="color: #9ca3af;">Rate:</span>
            <span id="em-rpm" style="color: #fbbf24; font-weight: bold;">0</span> rpm
        </div>
        <div style="margin-top: 4px; color: #6b7280; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="em-last-url">
            Waiting...
        </div>
        <div style="margin-top: 4px; background: #374151; height: 2px; width: 100%;">
            <div id="em-activity-bar" style="background: #ef4444; height: 100%; width: 0%; transition: width 0.2s;"></div>
        </div>
    `;

    function updateOverlay(lastUrl) {
        if (!document.body.contains(overlay)) {
            document.body.appendChild(overlay);
        }

        document.getElementById('em-session').textContent = sessionReads;
        document.getElementById('em-total').textContent = totalReads;
        document.getElementById('em-rpm').textContent = readsPerMinute;

        if (lastUrl) {
            document.getElementById('em-last-url').textContent = lastUrl;
        }

        // Animate activity bar
        const bar = document.getElementById('em-activity-bar');
        bar.style.width = '100%';
        setTimeout(() => { bar.style.width = '0%'; }, 200);
    }

    // Wait for body to insert overlay
    if (document.body) {
        document.body.appendChild(overlay);
    } else {
        window.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
    }

    // Periodically update total from local storage in case other tabs change it
    setInterval(() => {
        const stored = parseInt(localStorage.getItem('total_firestore_reads') || '0', 10);
        if (stored > totalReads) {
            totalReads = stored;
            updateOverlay();
        }
    }, 1000);

})();
