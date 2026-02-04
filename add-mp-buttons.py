# Add View and Delete buttons to MP Debug
with open('www/index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the line with createTestPlayer button
insert_at = -1
for i, line in enumerate(lines):
    if 'onclick="createTestPlayer()"' in line:
        # Go back to find the opening <div class="space-y-1">
        for j in range(i-1, max(i-10, 0), -1):
            if '<div class="space-y-1">' in lines[j]:
                insert_at = j
                break
        break

if insert_at == -1:
    print('ERROR: Could not find insertion point')
    exit(1)

# Create new buttons section
new_section = '''    <!-- Player Actions (2 columns) -->
    <div class="grid grid-cols-2 gap-1">
        <button onclick="switchToPlayer()" 
                class="py-2 bg-purple-700 hover:bg-purple-600 rounded-lg text-xs font-bold">
            👁️ View
        </button>
        <button onclick="deleteSelectedPlayer()" 
                class="py-2 bg-red-700 hover:bg-red-600 rounded-lg text-xs font-bold">
            🗑️ Delete
        </button>
    </div>

    <!-- Creation & Map Actions -->
'''

# Insert before the space-y-1 div
lines.insert(insert_at, new_section + '\n')

# Write back
with open('www/index.html', 'w', encoding='utf-8', newline='') as f:
    f.writelines(lines)

print(f'✅ Added View and Delete buttons at line {insert_at + 1}!')
print('Reload browser with Ctrl+F5 to see changes.')
