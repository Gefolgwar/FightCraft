<#
.SYNOPSIS
    Check Firebase RTDB health (orphaned records, stale data).

.DESCRIPTION
    Generates MCP commands for RTDB health checking.
    Identifies orphaned records, stale players, abandoned battles.

.PARAMETER WhatIf
    Show which nodes would be checked.

.EXAMPLE
    .\.agents\execution\rtdb-health.ps1
#>

param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$nodes = @(
    @{ Path = "/live_players"; Label = "Online Players"; Issues = "stale records (>24h without update)" },
    @{ Path = "/battle_requests"; Label = "PvP Requests"; Issues = "orphaned requests (pending >1h)" },
    @{ Path = "/battles"; Label = "Active Battles"; Issues = "unfinished battles (no moves >30min)" },
    @{ Path = "/arenas"; Label = "Arenas"; Issues = "arenas without active battles" },
    @{ Path = "/groups"; Label = "Groups"; Issues = "groups without leader or members" }
)

Write-Host ""
Write-Host ">>> RTDB Health Check" -ForegroundColor Cyan
Write-Host ("=" * 50)

if ($WhatIf) {
    Write-Host "[WhatIf] Would check the following nodes:" -ForegroundColor Yellow
    foreach ($node in $nodes) {
        Write-Host "  Path: $($node.Path) - $($node.Label)"
        Write-Host "    Looking for: $($node.Issues)" -ForegroundColor Gray
    }
    exit 0
}

Write-Host ""
Write-Host "Execute the following MCP commands to check RTDB:" -ForegroundColor White
Write-Host ""

foreach ($node in $nodes) {
    Write-Host "--- $($node.Label) ---" -ForegroundColor White
    Write-Host "  MCP: realtimedatabase_get_data(path: `"$($node.Path)`")" -ForegroundColor Cyan
    Write-Host "  Look for: $($node.Issues)" -ForegroundColor Gray
    Write-Host ""
}

Write-Host ("=" * 50)
Write-Host ""
Write-Host "Health criteria:"
Write-Host "  OK: live_players - all records have lat, lng, name; timestamp < 24h"
Write-Host "  OK: battle_requests - no pending requests older than 1 hour"
Write-Host "  OK: battles - all battles have active moves or are completed"
Write-Host "  OK: arenas - each arena has a corresponding battle record"
Write-Host "  OK: groups - each group has leader and at least 1 member"
Write-Host ""

exit 0
