<#
.SYNOPSIS
    Snapshot game balance data from source files.

.DESCRIPTION
    Extracts items[], monsters[], levelBonuses[] stats from www/gameplay/data.js
    and outputs summary for comparison with Firestore templates.

.PARAMETER WhatIf
    Show which files would be read.

.EXAMPLE
    .\.agents\execution\balance-snapshot.ps1
#>

param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$files = @(
    @{ Path = "www\gameplay\data.js"; Label = "Game Data (items, monsters)" },
    @{ Path = "www\gameplay\combat.js"; Label = "Combat Formulas" },
    @{ Path = "www\core\gameState.js"; Label = "Player Stats" }
)

Write-Host ""
Write-Host ">>> Balance Snapshot" -ForegroundColor Cyan
Write-Host ("=" * 50)

foreach ($file in $files) {
    $fullPath = Join-Path $ProjectRoot $file.Path

    if (-not (Test-Path $fullPath)) {
        Write-Host "  WARN: $($file.Label) - file not found ($($file.Path))" -ForegroundColor Yellow
        continue
    }

    if ($WhatIf) {
        Write-Host "  [WhatIf] Would read: $($file.Label) ($($file.Path))" -ForegroundColor Yellow
        continue
    }

    Write-Host ""
    Write-Host "--- $($file.Label) ---" -ForegroundColor White
    Write-Host "  File: $($file.Path)" -ForegroundColor Gray
    
    $content = Get-Content $fullPath -Raw

    # Count named entries  
    $itemMatches = [regex]::Matches($content, "(?:name|id)\s*:\s*['""]([^'""]+)['""]")
    Write-Host "  Named entries: $($itemMatches.Count)"

    # Search for key patterns
    $patterns = @{
        "damage"  = [regex]::Matches($content, "damage\s*:\s*(\d+)").Count
        "defense" = [regex]::Matches($content, "defense\s*:\s*(\d+)").Count
        "hp"      = [regex]::Matches($content, "hp\s*:\s*(\d+)").Count
        "xp"      = [regex]::Matches($content, "xp\s*:\s*(\d+)").Count
        "level"   = [regex]::Matches($content, "level\s*:\s*(\d+)").Count
    }

    foreach ($key in $patterns.Keys) {
        if ($patterns[$key] -gt 0) {
            Write-Host "    ${key}: $($patterns[$key]) values" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host ("=" * 50)
Write-Host "To compare with Firestore templates, use MCP:" -ForegroundColor Cyan
Write-Host "  firestore_query_collection(collection_path: `"templates/`", filters: [])" -ForegroundColor Gray

exit 0
