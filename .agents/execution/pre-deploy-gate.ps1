<#
.SYNOPSIS
    Pre-deploy gate - full safety check before Firebase deployment.

.DESCRIPTION
    Combines all checks into one script:
    1. Rules files exist
    2. Forbidden patterns (if true, missing isAdmin)
    3. Uncommitted changes in rules files
    4. firebase.json integrity
    
    Returns exit code 0 (PASS) or 1 (FAIL).

.PARAMETER WhatIf
    Show what would be checked without executing.

.EXAMPLE
    .\.agents\execution\pre-deploy-gate.ps1
    .\.agents\execution\pre-deploy-gate.ps1 -WhatIf
#>

param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$checks = @()
$hasBlocker = $false

Write-Host ""
Write-Host ">>> Pre-Deploy Gate" -ForegroundColor Cyan
Write-Host ("=" * 50)

if ($WhatIf) {
    Write-Host "[WhatIf] Checks that would run:" -ForegroundColor Yellow
    Write-Host "  1. Firebase Rules files exist (3 files)"
    Write-Host "  2. Forbidden patterns ('if true')"
    Write-Host "  3. isAdmin() in Firestore rules"
    Write-Host "  4. Git status of rules files"
    Write-Host "  5. firebase.json integrity"
    exit 0
}

# --- CHECK 1: Rules files exist ---
Write-Host ""
Write-Host "[1/5] Checking rules files..." -ForegroundColor White
$rulesFiles = @(
    "firebase\firestore.rules",
    "firebase\database.rules.json",
    "firebase\storage.rules"
)

foreach ($rf in $rulesFiles) {
    $fp = Join-Path $ProjectRoot $rf
    if (Test-Path $fp) {
        Write-Host "  OK: $rf" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: $rf - NOT FOUND" -ForegroundColor Red
        $hasBlocker = $true
        $checks += "FAIL: Missing $rf"
    }
}

# --- CHECK 2: Forbidden patterns ---
Write-Host ""
Write-Host "[2/5] Searching for 'if true'..." -ForegroundColor White
foreach ($rf in $rulesFiles) {
    $fp = Join-Path $ProjectRoot $rf
    if (-not (Test-Path $fp)) { continue }
    
    $matches = Select-String -Pattern "if\s+true" -Path $fp -AllMatches
    if ($matches) {
        Write-Host "  CRITICAL: 'if true' found in $rf!" -ForegroundColor Red
        foreach ($m in $matches) {
            Write-Host "    Line $($m.LineNumber): $($m.Line.Trim())" -ForegroundColor Red
        }
        $hasBlocker = $true
        $checks += "CRITICAL: 'if true' in $rf"
    } else {
        Write-Host "  OK: $rf - clean" -ForegroundColor Green
    }
}

# --- CHECK 3: isAdmin() ---
Write-Host ""
Write-Host "[3/5] Checking isAdmin()..." -ForegroundColor White
$firestorePath = Join-Path $ProjectRoot "firebase\firestore.rules"
if (Test-Path $firestorePath) {
    $adminCheck = Select-String -Pattern "isAdmin" -Path $firestorePath
    if ($adminCheck) {
        Write-Host "  OK: isAdmin() found ($($adminCheck.Count) occurrences)" -ForegroundColor Green
    } else {
        Write-Host "  WARN: isAdmin() NOT found in firestore.rules" -ForegroundColor Yellow
        $checks += "WARN: isAdmin() missing"
    }
}

# --- CHECK 4: Git status ---
Write-Host ""
Write-Host "[4/5] Git status of rules files..." -ForegroundColor White
try {
    Push-Location $ProjectRoot
    $gitStatus = git status --porcelain $rulesFiles 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARN: Git not available or not a repo" -ForegroundColor Yellow
    } elseif ($gitStatus) {
        Write-Host "  WARN: Uncommitted changes:" -ForegroundColor Yellow
        foreach ($line in $gitStatus) {
            Write-Host "    $line" -ForegroundColor Yellow
        }
        $checks += "WARN: Uncommitted rules changes"
    } else {
        Write-Host "  OK: All rules files committed" -ForegroundColor Green
    }
} catch {
    Write-Host "  WARN: Git check failed: $($_.Exception.Message)" -ForegroundColor Yellow
} finally {
    Pop-Location
}

# --- CHECK 5: firebase.json ---
Write-Host ""
Write-Host "[5/5] Checking firebase.json..." -ForegroundColor White
$firebaseJson = Join-Path $ProjectRoot "firebase.json"
if (Test-Path $firebaseJson) {
    try {
        $null = Get-Content $firebaseJson -Raw | ConvertFrom-Json
        Write-Host "  OK: firebase.json is valid JSON" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL: firebase.json is invalid JSON!" -ForegroundColor Red
        $hasBlocker = $true
        $checks += "FAIL: Invalid firebase.json"
    }
} else {
    Write-Host "  FAIL: firebase.json not found!" -ForegroundColor Red
    $hasBlocker = $true
    $checks += "FAIL: Missing firebase.json"
}

# --- RESULT ---
Write-Host ""
Write-Host ("=" * 50)

if ($hasBlocker) {
    Write-Host "RESULT: PRE-DEPLOY GATE FAIL" -ForegroundColor Red
    Write-Host "  Deploy BLOCKED. Findings:" -ForegroundColor Red
    foreach ($c in $checks) {
        Write-Host "  - $c" -ForegroundColor Red
    }
    exit 1
} elseif ($checks.Count -gt 0) {
    Write-Host "RESULT: PRE-DEPLOY GATE PASS (with warnings)" -ForegroundColor Yellow
    foreach ($c in $checks) {
        Write-Host "  - $c" -ForegroundColor Yellow
    }
    exit 0
} else {
    Write-Host "RESULT: PRE-DEPLOY GATE PASS" -ForegroundColor Green
    Write-Host "  Deploy allowed." -ForegroundColor Green
    exit 0
}
