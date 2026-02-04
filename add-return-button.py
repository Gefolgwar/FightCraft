# Add "Return to Self" button after View/Delete buttons
with open('www/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the View/Delete grid section
find_pattern = '''    <div class="grid grid-cols-2 gap-1">
        <button onclick="switchToPlayer()"'''

replace_pattern = '''    <!-- Return to Self (when controlling another player) -->
    <button id="return-to-self-btn" onclick="returnToSelf()" 
            class="hidden w-full py-2 bg-green-700 hover:bg-green-600 rounded-lg text-xs font-bold mb-2">
        ↩️ Return to Self
    </button>

    <div class="grid grid-cols-2 gap-1">
        <button onclick="switchToPlayer()"'''

if find_pattern in content:
    content = content.replace(find_pattern, replace_pattern, 1)
    print('✅ Added Return to Self button!')
else:
    print('❌ Pattern not found')
    if 'switchToPlayer()' in content:
        print('Found switchToPlayer, but pattern different')

# Write back
with open('www/index.html', 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print('Done!')
