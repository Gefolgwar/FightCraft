<#
.SYNOPSIS
    Compare local Firebase Rules with production version.

.DESCRIPTION
    Reads local rules files and prepares hashes for drift comparison.
    Production rules are fetched via MCP tool firebase_get_security_rules.

.PARAMETER WhatIf
    Show which files would be compared without executing.

.PARAMETER Type
    Rules type: firestore, rtdb, storage, or all. Default: all.

.EXAMPLE
    .\.agents\execution\drift-check.ps1
    .\.agents\execution\drift-check.ps1 -Type firestore
#>

param(
    [ValidateSet("firestore", "rtdb", "storage", "all")]
    [string]$Type = "all",
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$rulesMap = @{
    "firestore" = @{ Path = "firebase\firestore.rules"; Label = "Firestore" }
    "rtdb"      = @{ Path = "firebase\database.rules.json"; Label = "RTDB" }
    "storage"   = @{ Path = "firebase\storage.rules"; Label = "Storage" }
}

$targets = if ($Type -eq "all") { $rulesMap.Keys } else { @($Type) }

Write-Host ""
Write-Host ">>> Firebase Rules Drift Check" -ForegroundColor Cyan
Write-Host ("=" * 50)

foreach ($t in $targets) {
    $rule = $rulesMap[$t]
    $fullPath = Join-Path $ProjectRoot $rule.Path

    if (-not (Test-Path $fullPath)) {
        Write-Host "  WARN: $($rule.Label) - file not found ($($rule.Path))" -ForegroundColor Yellow
        continue
    }

    if ($WhatIf) {
        Write-Host "  [WhatIf] Would compare: $($rule.Label) ($($rule.Path))" -ForegroundColor Yellow
        continue
    }

    Write-Host ""
    Write-Host "--- $($rule.Label) ---" -ForegroundColor White

    $localContent = Get-Content $fullPath -Raw
    $localHash = (Get-FileHash $fullPath -Algorithm SHA256).Hash.Substring(0, 12)
    $localLines = ($localContent -split "`n").Count

    Write-Host "  Local file: $($rule.Path)" 
    Write-Host "    Lines: $localLines | SHA256: $localHash"
    Write-Host ""
    Write-Host "  To compare with production, use MCP:" -ForegroundColor Yellow
    Write-Host "    firebase_get_security_rules(type: `"$t`")" -ForegroundColor Gray
}

Write-Host ""
Write-Host ("=" * 50)

if ($WhatIf) {
    Write-Host "Dry-run complete." -ForegroundColor Yellow
} else {
    Write-Host "Local hashes ready. Use MCP for production comparison." -ForegroundColor Cyan
}

exit 0
