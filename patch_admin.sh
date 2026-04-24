#!/bin/bash

# Insert the button
sed -i 's|<button onclick="forceGlobalUpdate()"|<button onclick="window.generateGlobalWorld()" class="px-4 py-2 bg-yellow-700 hover:bg-yellow-600 rounded-lg text-sm font-bold border border-yellow-500 shadow-lg shadow-yellow-900/50">🌍 Generate Full World</button>\n                <button onclick="forceGlobalUpdate()"|' www/maintenance/admin.html

# Insert the progress bar container
sed -i '/<!-- Stats -->/i \
        <!-- World Generator Progress -->\
        <div id="world-progress-container" class="hidden glass p-4 rounded-xl border border-yellow-500/30 mb-6">\
            <div class="flex justify-between items-center mb-2">\
                <h3 class="font-bold text-yellow-400">🌍 Generating World...</h3>\
                <span id="world-progress-text" class="text-sm text-gray-400">0 / X Cities</span>\
            </div>\
            <div class="w-full bg-gray-800 rounded-full h-4 overflow-hidden border border-gray-700">\
                <div id="world-progress-bar" class="bg-gradient-to-r from-yellow-600 to-yellow-400 h-4 transition-all duration-300" style="width: 0%"></div>\
            </div>\
            <p id="world-progress-status" class="text-xs text-gray-500 mt-2">Initializing...</p>\
        </div>\
' www/maintenance/admin.html

