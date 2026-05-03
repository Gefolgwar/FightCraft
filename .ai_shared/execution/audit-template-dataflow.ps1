<#
.SYNOPSIS
    Audits the Template-Sync data flow across all JS modules.

.DESCRIPTION
    Validates that the full Template-Sync pipeline is correctly wired:

    Admin UI -> generateGlobalWorld -> Firestore [world_snapshots]
                                            | onSnapshot listener
                                      Admin DOM auto-updates sidebar
                                            | toggle Active
                                      applyWorldSnapshot -> spawned_objects
                                            | world_metadata timestamp
                                      Game client SyncEngine delta-sync

    Checks cover:
    - generateGlobalWorld definition and HTML callability
    - saveWorldSnapshot invocation after generation
    - subscribeToWorldSnapshots listener existence and wiring
    - Toggle functions: toggleCurrentSnapshot, forceCurrentSnapshotState
    - applyWorldSnapshot sourceTemplateId injection
    - deactivateWorldSnapshot sourceTemplateId query
    - No redundant loadSnapshots calls in toggle handlers
    - beforeunload cleanup handler

.NOTES
    Part of the DOE Execution Layer.
    Run from project root: powershell -File .ai_shared/execution/audit-template-dataflow.ps1
#>

param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = "Stop"

# --- File paths ---
$adminWorldJs     = Join-Path (Join-Path $ProjectRoot "www") "maintenance"
$adminWorldJs     = Join-Path $adminWorldJs "admin-world.js"

$adminHtml        = Join-Path (Join-Path $ProjectRoot "www") "maintenance"
$adminHtml        = Join-Path $adminHtml "admin.html"

$templatesMapHtml = Join-Path (Join-Path $ProjectRoot "www") "map"
$templatesMapHtml = Join-Path $templatesMapHtml "templates_map.html"

$firebaseService  = Join-Path (Join-Path $ProjectRoot "www") "firebase"
$firebaseService  = Join-Path $firebaseService "firebase-service.js"

# --- Counters ---
$script:passCount = 0
$script:warnCount = 0
$script:failCount = 0

function Write-Pass {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
    $script:passCount++
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
    $script:warnCount++
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    $script:failCount++
}

# ============================================================
Write-Host "=== Template-Sync Data Flow Audit ===" -ForegroundColor Cyan
Write-Host ""
# ============================================================

# --- Pre-flight: verify required files exist ---
$requiredFiles = @(
    @{ Path = $adminWorldJs;     Label = "admin-world.js" },
    @{ Path = $adminHtml;        Label = "admin.html" },
    @{ Path = $templatesMapHtml; Label = "templates_map.html" },
    @{ Path = $firebaseService;  Label = "firebase-service.js" }
)

$missingFiles = $false
foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file.Path)) {
        $msg = "[FAIL] " + $file.Label + " not found at " + $file.Path
        Write-Host $msg -ForegroundColor Red
        $script:failCount++
        $missingFiles = $true
    }
}

if ($missingFiles) {
    Write-Host ""
    Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "  ABORTED - missing required source files" -ForegroundColor Red
    Write-Host "===============" -ForegroundColor Cyan
    exit 1
}

Write-Host "[INFO] All source files located" -ForegroundColor DarkGray
Write-Host ""

# --- Load file contents ---
$adminWorldContent      = Get-Content $adminWorldJs     -Raw
$adminHtmlContent       = Get-Content $adminHtml        -Raw
$templatesMapContent    = Get-Content $templatesMapHtml -Raw
$firebaseServiceContent = Get-Content $firebaseService  -Raw

# ============================================================
# Check 1: generateGlobalWorld exists in admin-world.js
# ============================================================
Write-Host "--- Check 1: generateGlobalWorld definition ---" -ForegroundColor DarkCyan
if ($adminWorldContent -match "window\.generateGlobalWorld") {
    Write-Pass "window.generateGlobalWorld found in admin-world.js"
} else {
    Write-Fail "window.generateGlobalWorld NOT found in admin-world.js"
}

# ============================================================
# Check 2: generateGlobalWorld callable from HTML
# ============================================================
Write-Host "--- Check 2: generateGlobalWorld callable from HTML ---" -ForegroundColor DarkCyan

$foundInAdmin = $adminHtmlContent -match "generateGlobalWorld"
$foundInTemplatesMap = $templatesMapContent -match "generateGlobalWorld"

if ($foundInAdmin -and $foundInTemplatesMap) {
    Write-Pass "generateGlobalWorld referenced in both admin.html and templates_map.html"
} elseif ($foundInAdmin) {
    Write-Warn "generateGlobalWorld found in admin.html but NOT in templates_map.html"
} elseif ($foundInTemplatesMap) {
    Write-Warn "generateGlobalWorld found in templates_map.html but NOT in admin.html"
} else {
    Write-Fail "generateGlobalWorld NOT referenced in admin.html or templates_map.html"
}

# ============================================================
# Check 3: saveWorldSnapshot called after generation
# ============================================================
Write-Host "--- Check 3: saveWorldSnapshot called in admin-world.js ---" -ForegroundColor DarkCyan
if ($adminWorldContent -match "saveWorldSnapshot") {
    Write-Pass "saveWorldSnapshot call found in admin-world.js"
} else {
    Write-Fail "saveWorldSnapshot NOT found in admin-world.js - snapshots will not persist"
}

# ============================================================
# Check 4: subscribeToWorldSnapshots listener exists
# ============================================================
Write-Host "--- Check 4: subscribeToWorldSnapshots listener definition ---" -ForegroundColor DarkCyan
if ($firebaseServiceContent -match "function\s+subscribeToWorldSnapshots") {
    Write-Pass "subscribeToWorldSnapshots defined in firebase-service.js"
} else {
    Write-Fail "subscribeToWorldSnapshots NOT found in firebase-service.js"
}

# ============================================================
# Check 5: Listener wired in templates_map.html
# ============================================================
Write-Host "--- Check 5: subscribeToWorldSnapshots wired in templates_map.html ---" -ForegroundColor DarkCyan
if ($templatesMapContent -match "subscribeToWorldSnapshots") {
    Write-Pass "subscribeToWorldSnapshots referenced in templates_map.html"
} else {
    Write-Fail "subscribeToWorldSnapshots NOT wired in templates_map.html - sidebar will not auto-update"
}

# ============================================================
# Check 6: Toggle functions exist
# ============================================================
Write-Host "--- Check 6: Toggle functions in templates_map.html ---" -ForegroundColor DarkCyan

$hasToggle = $templatesMapContent -match "toggleCurrentSnapshot"
$hasForce  = $templatesMapContent -match "forceCurrentSnapshotState"

if ($hasToggle -and $hasForce) {
    Write-Pass "Both toggleCurrentSnapshot and forceCurrentSnapshotState found"
} elseif ($hasToggle) {
    Write-Warn "toggleCurrentSnapshot found but forceCurrentSnapshotState MISSING"
} elseif ($hasForce) {
    Write-Warn "forceCurrentSnapshotState found but toggleCurrentSnapshot MISSING"
} else {
    Write-Fail "Neither toggleCurrentSnapshot nor forceCurrentSnapshotState found"
}

# ============================================================
# Check 7: applyWorldSnapshot injects sourceTemplateId
# ============================================================
Write-Host "--- Check 7: applyWorldSnapshot injects sourceTemplateId ---" -ForegroundColor DarkCyan
if ($firebaseServiceContent -match "sourceTemplateId") {
    Write-Pass "sourceTemplateId found in firebase-service.js"
} else {
    Write-Fail "sourceTemplateId NOT found - deactivation will not work"
}

# ============================================================
# Check 8: deactivateWorldSnapshot queries by sourceTemplateId
# ============================================================
Write-Host "--- Check 8: deactivateWorldSnapshot queries by sourceTemplateId ---" -ForegroundColor DarkCyan
if ($firebaseServiceContent -match "where.*sourceTemplateId") {
    Write-Pass "where + sourceTemplateId query found in firebase-service.js"
} else {
    Write-Fail "No where sourceTemplateId query - cleanup may orphan spawned_objects"
}

# ============================================================
# Check 9: No redundant loadSnapshots in toggle handlers
# ============================================================
Write-Host "--- Check 9: Redundant loadSnapshots calls ---" -ForegroundColor DarkCyan

$loadSnapshotPattern = 'loadSnapshots\s*\('
$loadSnapshotMatches = [regex]::Matches($templatesMapContent, $loadSnapshotPattern)
$matchCount = $loadSnapshotMatches.Count

if ($matchCount -le 2) {
    $msg = "loadSnapshots appears " + $matchCount.ToString() + " time[s] - within expected range [<=2]"
    Write-Pass $msg
} else {
    $msg = "loadSnapshots appears " + $matchCount.ToString() + " time[s] - expected <=2. Possible redundant calls in toggle handlers"
    Write-Warn $msg
}

# ============================================================
# Check 10: beforeunload cleanup
# ============================================================
Write-Host "--- Check 10: beforeunload cleanup handler ---" -ForegroundColor DarkCyan
if ($templatesMapContent -match "beforeunload") {
    Write-Pass "beforeunload handler found in templates_map.html"
} else {
    Write-Warn "No beforeunload handler - onSnapshot listeners may leak on navigation"
}

# ============================================================
# Summary
# ============================================================
Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan

$total = $script:passCount + $script:warnCount + $script:failCount
Write-Host "  Total checks : $total" -ForegroundColor White
Write-Host "  Passed       : $($script:passCount)" -ForegroundColor Green

if ($script:warnCount -gt 0) {
    Write-Host "  Warnings     : $($script:warnCount)" -ForegroundColor Yellow
} else {
    Write-Host "  Warnings     : 0" -ForegroundColor White
}

if ($script:failCount -gt 0) {
    Write-Host "  Failed       : $($script:failCount)" -ForegroundColor Red
} else {
    Write-Host "  Failed       : 0" -ForegroundColor White
}

Write-Host ""

if ($script:failCount -eq 0 -and $script:warnCount -eq 0) {
    Write-Host "  ALL CHECKS PASSED" -ForegroundColor Green
} elseif ($script:failCount -eq 0) {
    Write-Host "  ALL CRITICAL CHECKS PASSED [warnings need attention]" -ForegroundColor Yellow
} else {
    Write-Host "  SOME CHECKS FAILED - data flow may be broken" -ForegroundColor Red
}

Write-Host "===============" -ForegroundColor Cyan
