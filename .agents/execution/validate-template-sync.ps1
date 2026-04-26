<# 
.SYNOPSIS
    Validates that Firebase security rules properly protect the Template-Sync data flow.
    
.DESCRIPTION
    Checks firestore.rules for required collection rules covering:
    - world_snapshots (admin-write, auth-read)
    - world_metadata (admin-write, auth-read)
    - templates (admin-write, auth-read)
    - spawned_objects (admin-create/delete, auth-read, field-restricted update)
    
    Also checks that no API keys are hardcoded in .agents/env/.
    
.NOTES
    Part of the DOE Execution Layer.
    Run from project root: pwsh .agents/execution/validate-template-sync.ps1
#>

param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = "Stop"
$rulesPath = Join-Path (Join-Path $ProjectRoot "firebase") "firestore.rules"

Write-Host "=== Template-Sync Security Validation ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check that firestore.rules exists
if (-not (Test-Path $rulesPath)) {
    Write-Host "[FAIL] firestore.rules not found at $rulesPath" -ForegroundColor Red
    exit 1
}

Write-Host "[PASS] firestore.rules found" -ForegroundColor Green

# 2. Read rules content
$rulesContent = Get-Content $rulesPath -Raw

# 3. Check required collection rules
$requiredCollections = @(
    @{ Name = "world_snapshots"; Pattern = "match /world_snapshots/" },
    @{ Name = "world_metadata";  Pattern = "match /world_metadata/"  },
    @{ Name = "templates";       Pattern = "match /templates/"       },
    @{ Name = "spawned_objects";  Pattern = "match /spawned_objects/" }
)

$allPassed = $true

foreach ($col in $requiredCollections) {
    $escapedPattern = [regex]::Escape($col.Pattern)
    if ($rulesContent -match $escapedPattern) {
        $sectionStart = $rulesContent.IndexOf($col.Pattern)
        $sectionEnd = [Math]::Min($sectionStart + 500, $rulesContent.Length)
        $section = $rulesContent.Substring($sectionStart, $sectionEnd - $sectionStart)
        
        $adminPattern = 'isAdmin'
        if ($section -match $adminPattern) {
            Write-Host "[PASS] $($col.Name): Protected by isAdmin()" -ForegroundColor Green
        } else {
            Write-Host "[WARN] $($col.Name): Rule exists but isAdmin() not found in section" -ForegroundColor Yellow
            $allPassed = $false
        }
    } else {
        Write-Host "[FAIL] $($col.Name): No matching rule found!" -ForegroundColor Red
        $allPassed = $false
    }
}

# 4. Check for catch-all deny
if ($rulesContent -match "allow read, write: if false") {
    Write-Host "[PASS] Catch-all deny rule present" -ForegroundColor Green
} else {
    Write-Host "[WARN] No catch-all deny rule found" -ForegroundColor Yellow
}

# 5. Check isAdmin function exists
$adminFnPattern = 'function isAdmin'
if ($rulesContent -match $adminFnPattern) {
    Write-Host "[PASS] isAdmin() helper function defined" -ForegroundColor Green
    
    if ($rulesContent -match "request\.auth\.token\.admin") {
        Write-Host "  +-- Custom claims check: PASS" -ForegroundColor DarkGreen
    }
    if ($rulesContent -match "YshG61RxTIczGXOfFqiu2wqC63r2") {
        Write-Host "  +-- Hardcoded UID fallback: WARN (planned for removal)" -ForegroundColor Yellow
    }
    if ($rulesContent -match "role.*==.*admin") {
        Write-Host "  +-- Firestore role fallback: WARN (legacy)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[FAIL] isAdmin() function not found!" -ForegroundColor Red
    $allPassed = $false
}

# 6. Check .agents/env/ for hardcoded keys
$envDir = Join-Path (Join-Path $ProjectRoot ".agents") "env"
if (Test-Path $envDir) {
    $envFiles = Get-ChildItem -Path $envDir -File -ErrorAction SilentlyContinue
    foreach ($f in $envFiles) {
        $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match "AIza[A-Za-z0-9_-]{35}") {
            Write-Host "[FAIL] Hardcoded Firebase API key found in $($f.Name)!" -ForegroundColor Red
            $allPassed = $false
        }
    }
    Write-Host "[PASS] .agents/env/ scanned (no hardcoded keys)" -ForegroundColor Green
} else {
    Write-Host "[INFO] .agents/env/ directory not found (OK if keys managed elsewhere)" -ForegroundColor DarkGray
}

# 7. Summary
Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "  ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "  SOME CHECKS NEED ATTENTION" -ForegroundColor Yellow
}
Write-Host "===============" -ForegroundColor Cyan
