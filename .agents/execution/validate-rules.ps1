<#
.SYNOPSIS
    Validate Firebase Security Rules syntax (Firestore, RTDB, Storage).

.DESCRIPTION
    Checks all three rules files for syntax errors and forbidden patterns.
    Returns exit code 0 (all valid) or 1 (errors found).

.PARAMETER WhatIf
    Show which files would be checked without executing.

.EXAMPLE
    .\.agents\execution\validate-rules.ps1
    .\.agents\execution\validate-rules.ps1 -WhatIf
#>

param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# --- Config ---
$rulesFiles = @(
    @{ Type = "firestore"; Path = "firebase\firestore.rules"; Label = "Firestore Rules" },
    @{ Type = "rtdb";      Path = "firebase\database.rules.json"; Label = "RTDB Rules" },
    @{ Type = "storage";   Path = "firebase\storage.rules"; Label = "Storage Rules" }
)

$hasErrors = $false

Write-Host ""
Write-Host ">>> Firebase Rules Validation" -ForegroundColor Cyan
Write-Host ("=" * 50)

foreach ($rule in $rulesFiles) {
    $fullPath = Join-Path $ProjectRoot $rule.Path

    if (-not (Test-Path $fullPath)) {
        Write-Host "  FAIL: $($rule.Label) - file NOT FOUND ($($rule.Path))" -ForegroundColor Red
        $hasErrors = $true
        continue
    }

    if ($WhatIf) {
        Write-Host "  [WhatIf] Would validate: $($rule.Label) ($($rule.Path))" -ForegroundColor Yellow
        continue
    }

    Write-Host "  Checking: $($rule.Label)..." -NoNewline

    $content = Get-Content $fullPath -Raw

    # Check 1: "if true"
    if ($content -match "if\s+true") {
        Write-Host " CRITICAL: found 'if true'!" -ForegroundColor Red
        $hasErrors = $true
        continue
    }

    # Check 2: Empty file
    if ([string]::IsNullOrWhiteSpace($content)) {
        Write-Host " FAIL: file is empty!" -ForegroundColor Red
        $hasErrors = $true
        continue
    }

    # Check 3: JSON validity for RTDB
    if ($rule.Type -eq "rtdb") {
        try {
            $null = $content | ConvertFrom-Json
            Write-Host " OK - valid JSON" -ForegroundColor Green
        } catch {
            Write-Host " FAIL: invalid JSON - $($_.Exception.Message)" -ForegroundColor Red
            $hasErrors = $true
        }
        continue
    }

    # Check 4: Basic syntax for Firestore/Storage rules
    if ($content -match "rules_version\s*=\s*'2'") {
        Write-Host " OK - Rules v2 syntax" -ForegroundColor Green
    } else {
        Write-Host " WARN: rules_version = '2' not found" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host ("=" * 50)

if ($WhatIf) {
    Write-Host "Dry-run complete. No validation performed." -ForegroundColor Yellow
    exit 0
}

if ($hasErrors) {
    Write-Host "FAIL: Errors found in Firebase Rules!" -ForegroundColor Red
    Write-Host "  Deploy BLOCKED." -ForegroundColor Red
    exit 1
} else {
    Write-Host "PASS: All Firebase Rules are valid." -ForegroundColor Green
    exit 0
}
