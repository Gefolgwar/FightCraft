# Add Clean Unknown button to MP Debug UI
with open('www/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the Show All on Map button and add Clean Unknown after it
old_button = '''        <button onclick="showAllPlayersOnMap()" class="w-full py-2 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-xs">
            🗺️ Show All on Map
        </button>
    </div>'''

new_buttons = '''        <button onclick="showAllPlayersOnMap()" class="w-full py-2 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-xs">
            🗺️ Show All on Map
        </button>
        <button onclick="cleanUnknownPlayers()" class="w-full py-2 bg-orange-700 hover:bg-orange-600 rounded-lg text-xs">
            🧹 Clean Unknown
        </button>
    </div>'''

if old_button in content:
    content = content.replace(old_button, new_buttons, 1)
    print('✅ Added Clean Unknown button!')
else:
    print('❌ Could not find Show All button')
    print('Searching for alternative...')
    
    # Try alternative pattern
    if 'showAllPlayersOnMap()' in content:
        print('Found showAllPlayersOnMap, manual insertion needed')
    else:
        print('Button not found at all')

# Write back
with open('www/index.html', 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print('Done!')
