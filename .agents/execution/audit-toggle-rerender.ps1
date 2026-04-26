<#
.SYNOPSIS
    Audits the Activation/Inactivation toggle logic for unnecessary re-renders and cache wipes.

.DESCRIPTION
    Detects anti-patterns in the snapshot toggle data flow:

    toggleCurrentSnapshot()  --> applyWorldSnapshot() / deactivateWorldSnapshot()
                                       | Firestore write
                                 onSnapshot listener fires
                                       | renderSnapshotList() auto-called
                                 Sidebar re-renders (NO manual reload needed)

    Anti-patterns checked:
    1. Double re-render: loadSnapshots called inside toggleCurrentSnapshot or
       forceCurrentSnapshotState — redundant because onSnapshot listener already
       triggers renderSnapshotList.
    2. Unnecessary cache wipes: localStorage.removeItem("admin_snapshots_list")
       in toggle handler code — already handled in firebase-service.js functions
       AND the onSnapshot callback.
    3. Missing listener cleanup: _snapshotUnsubscribe must be called on
       beforeunload to prevent leaked onSnapshot listeners.
    4. Cache wipe in Firebase service layer: applyWorldSnapshot and
       deactivateWorldSnapshot SHOULD clear localStorage("admin_snapshots_list")
       as the source-of-truth layer.

.NOTES
    Part of the DOE Execution Layer.
    Run from project root: pwsh .agents/execution/audit-toggle-rerender.ps1
#>

param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = "Stop"

# --- File paths ---
$templatesMapHtml = Join-Path (Join-Path (Join-Path $ProjectRoot "www") "map") "templates_map.html"
$firebaseService  = Join-Path (Join-Path (Join-Path $ProjectRoot "www") "firebase") "firebase-service.js"

# --- Counters ---
$passCount = 0
$warnCount = 0
$failCount = 0

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
Write-Host "=== Toggle Re-render / Cache Wipe Audit ===" -ForegroundColor Cyan
Write-Host ""
# ============================================================

# --- Pre-flight: verify required files exist ---
$requiredFiles = @(
    @{ Path = $templatesMapHtml; Label = "templates_map.html" },
    @{ Path = $firebaseService;  Label = "firebase-service.js" }
)

$missingFiles = $false
foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file.Path)) {
        Write-Fail "$($file.Label) not found at $($file.Path)"
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
$templatesMapContent   = Get-Content $templatesMapHtml -Raw
$firebaseServiceContent = Get-Content $firebaseService -Raw

# --- Helper: extract function body by window.funcName declaration ---
# Finds "window.<name> = async () => {" and captures until the matching
# closing brace at depth 0 (brace-counting heuristic).
function Get-ToggleHandlerBody {
    param(
        [string]$Source,
        [string]$FunctionName
    )

    $escapedName = [regex]::Escape($FunctionName)
    $pattern = '(?s)window\.' + $escapedName + '\s*=\s*async\s*\(\)\s*=>\s*\{'
    $match = [regex]::Match($Source, $pattern)

    if (-not $match.Success) {
        return $null
    }

    $startIdx = $match.Index
    $maxLen = [Math]::Min(3000, $Source.Length - $startIdx)
    $slice = $Source.Substring($startIdx, $maxLen)

    # Walk through and find the matching closing brace by tracking depth
    $braceDepth = 0
    $inBody = $false
    $bodyEnd = $slice.Length

    for ($i = $match.Length - 1; $i -lt $slice.Length; $i++) {
        $ch = $slice[$i]
        if ($ch -eq '{') {
            $braceDepth++
            $inBody = $true
        }
        elseif ($ch -eq '}') {
            $braceDepth--
            if ($inBody -and $braceDepth -eq 0) {
                $bodyEnd = $i + 1
                break
            }
        }
    }

    return $slice.Substring(0, $bodyEnd)
}

# --- Helper regex: matches loadSnapshots( ---
$rxLoadSnapshots = 'loadSnapshots\s*\('

# --- Helper regex: matches localStorage.removeItem("admin_snapshots_list") or single-quoted variant ---
$rxCacheWipe = 'localStorage\.removeItem\s*\(\s*[''"]admin_snapshots_list[''"]\s*\)'

# ============================================================
# Check 1: Double re-render — loadSnapshots in toggleCurrentSnapshot
# ============================================================
Write-Host "--- Check 1: loadSnapshots inside toggleCurrentSnapshot ---" -ForegroundColor DarkCyan

$toggleBody = Get-ToggleHandlerBody -Source $templatesMapContent -FunctionName "toggleCurrentSnapshot"

if ($null -eq $toggleBody) {
    Write-Fail 'Could not locate window.toggleCurrentSnapshot handler in templates_map.html'
} else {
    if ($toggleBody -match $rxLoadSnapshots) {
        Write-Fail 'loadSnapshots called inside toggleCurrentSnapshot -- double re-render! The onSnapshot listener already calls renderSnapshotList'
    } else {
        Write-Pass 'toggleCurrentSnapshot does NOT call loadSnapshots -- no double re-render'
    }
}

# ============================================================
# Check 2: Double re-render — loadSnapshots in forceCurrentSnapshotState
# ============================================================
Write-Host "--- Check 2: loadSnapshots inside forceCurrentSnapshotState ---" -ForegroundColor DarkCyan

$forceBody = Get-ToggleHandlerBody -Source $templatesMapContent -FunctionName "forceCurrentSnapshotState"

if ($null -eq $forceBody) {
    Write-Fail 'Could not locate window.forceCurrentSnapshotState handler in templates_map.html'
} else {
    if ($forceBody -match $rxLoadSnapshots) {
        Write-Fail 'loadSnapshots called inside forceCurrentSnapshotState -- double re-render! The onSnapshot listener already calls renderSnapshotList'
    } else {
        Write-Pass 'forceCurrentSnapshotState does NOT call loadSnapshots -- no double re-render'
    }
}

# ============================================================
# Check 3: Unnecessary cache wipe in toggleCurrentSnapshot
# ============================================================
Write-Host "--- Check 3: Cache wipe in toggleCurrentSnapshot ---" -ForegroundColor DarkCyan

if ($null -ne $toggleBody) {
    if ($toggleBody -match $rxCacheWipe) {
        Write-Fail 'localStorage.removeItem admin_snapshots_list found in toggleCurrentSnapshot -- redundant! Firebase service layer + onSnapshot callback already handle this'
    } else {
        Write-Pass 'toggleCurrentSnapshot has no redundant cache wipe'
    }
} else {
    Write-Warn 'Skipped -- toggleCurrentSnapshot body not extracted (see Check 1)'
}

# ============================================================
# Check 4: Unnecessary cache wipe in forceCurrentSnapshotState
# ============================================================
Write-Host "--- Check 4: Cache wipe in forceCurrentSnapshotState ---" -ForegroundColor DarkCyan

if ($null -ne $forceBody) {
    if ($forceBody -match $rxCacheWipe) {
        Write-Fail 'localStorage.removeItem admin_snapshots_list found in forceCurrentSnapshotState -- redundant! Firebase service layer + onSnapshot callback already handle this'
    } else {
        Write-Pass 'forceCurrentSnapshotState has no redundant cache wipe'
    }
} else {
    Write-Warn 'Skipped -- forceCurrentSnapshotState body not extracted (see Check 2)'
}

# ============================================================
# Check 5: Broader sweep — any cache wipe in templates_map.html at all
# ============================================================
Write-Host "--- Check 5: Any admin_snapshots_list cache wipe in templates_map.html ---" -ForegroundColor DarkCyan

$cacheWipeMatches = [regex]::Matches($templatesMapContent, $rxCacheWipe)

if ($cacheWipeMatches.Count -eq 0) {
    Write-Pass 'No localStorage.removeItem admin_snapshots_list in templates_map.html -- cache wipes correctly delegated to firebase-service.js'
} else {
    $hitCount = $cacheWipeMatches.Count
    Write-Warn "localStorage.removeItem admin_snapshots_list appears $hitCount time(s) in templates_map.html -- should only exist in firebase-service.js"
}

# ============================================================
# Check 6: _snapshotUnsubscribe cleanup on beforeunload
# ============================================================
Write-Host "--- Check 6: Listener cleanup on beforeunload ---" -ForegroundColor DarkCyan

$hasBeforeUnload = $templatesMapContent -match 'beforeunload'
$hasUnsubscribeCall = $templatesMapContent -match '_snapshotUnsubscribe\s*\(\s*\)'

if ($hasBeforeUnload -and $hasUnsubscribeCall) {
    # Verify they are wired together: beforeunload handler calls _snapshotUnsubscribe
    $cleanupPattern = '(?s)beforeunload.*?_snapshotUnsubscribe\s*\(\s*\)'
    if ($templatesMapContent -match $cleanupPattern) {
        Write-Pass '_snapshotUnsubscribe called in beforeunload handler -- listener cleanup confirmed'
    } else {
        Write-Warn 'Both beforeunload and _snapshotUnsubscribe exist, but they may not be wired together'
    }
} elseif ($hasBeforeUnload) {
    Write-Fail 'beforeunload handler exists but does NOT call _snapshotUnsubscribe -- onSnapshot listener will leak'
} elseif ($hasUnsubscribeCall) {
    Write-Warn '_snapshotUnsubscribe is called somewhere but no beforeunload handler found -- cleanup may not run on navigation'
} else {
    Write-Fail 'No beforeunload handler AND no _snapshotUnsubscribe call -- onSnapshot listener will leak on page navigation'
}

# ============================================================
# Check 7: _snapshotUnsubscribe variable declared
# ============================================================
Write-Host "--- Check 7: _snapshotUnsubscribe variable declared ---" -ForegroundColor DarkCyan

if ($templatesMapContent -match 'let\s+_snapshotUnsubscribe\s*=\s*null') {
    Write-Pass '_snapshotUnsubscribe declared with null initializer'
} elseif ($templatesMapContent -match '_snapshotUnsubscribe\s*=\s*subscribeToWorldSnapshots') {
    Write-Warn '_snapshotUnsubscribe assigned from subscribeToWorldSnapshots but null initializer not found'
} else {
    Write-Fail '_snapshotUnsubscribe not found -- onSnapshot listener has no cleanup reference'
}

# ============================================================
# Check 8: Cache wipe in applyWorldSnapshot (firebase-service.js)
# ============================================================
Write-Host "--- Check 8: Cache wipe in applyWorldSnapshot ---" -ForegroundColor DarkCyan

$applyPattern = '(?s)async\s+function\s+applyWorldSnapshot\s*\('
$applyMatch = [regex]::Match($firebaseServiceContent, $applyPattern)
if ($applyMatch.Success) {
    $startIdx = $applyMatch.Index
    $maxLen = [Math]::Min(2000, $firebaseServiceContent.Length - $startIdx)
    $applySlice = $firebaseServiceContent.Substring($startIdx, $maxLen)

    if ($applySlice -match $rxCacheWipe) {
        Write-Pass 'applyWorldSnapshot clears admin_snapshots_list cache -- correct (source-of-truth layer)'
    } else {
        Write-Fail 'applyWorldSnapshot does NOT clear admin_snapshots_list cache -- stale cache risk after activation'
    }
} else {
    Write-Fail 'applyWorldSnapshot function not found in firebase-service.js'
}

# ============================================================
# Check 9: Cache wipe in deactivateWorldSnapshot (firebase-service.js)
# ============================================================
Write-Host "--- Check 9: Cache wipe in deactivateWorldSnapshot ---" -ForegroundColor DarkCyan

$deactivatePattern = '(?s)async\s+function\s+deactivateWorldSnapshot\s*\('
$deactivateMatch = [regex]::Match($firebaseServiceContent, $deactivatePattern)
if ($deactivateMatch.Success) {
    $startIdx = $deactivateMatch.Index
    $maxLen = [Math]::Min(2000, $firebaseServiceContent.Length - $startIdx)
    $deactivateSlice = $firebaseServiceContent.Substring($startIdx, $maxLen)

    if ($deactivateSlice -match $rxCacheWipe) {
        Write-Pass 'deactivateWorldSnapshot clears admin_snapshots_list cache -- correct (source-of-truth layer)'
    } else {
        Write-Fail 'deactivateWorldSnapshot does NOT clear admin_snapshots_list cache -- stale cache risk after deactivation'
    }
} else {
    Write-Fail 'deactivateWorldSnapshot function not found in firebase-service.js'
}

# ============================================================
# Check 10: Cache wipe in onSnapshot callback (firebase-service.js)
# ============================================================
Write-Host "--- Check 10: Cache wipe in subscribeToWorldSnapshots onSnapshot callback ---" -ForegroundColor DarkCyan

$subscribePattern = '(?s)function\s+subscribeToWorldSnapshots\s*\('
$subscribeMatch = [regex]::Match($firebaseServiceContent, $subscribePattern)
if ($subscribeMatch.Success) {
    $startIdx = $subscribeMatch.Index
    $maxLen = [Math]::Min(2000, $firebaseServiceContent.Length - $startIdx)
    $subscribeSlice = $firebaseServiceContent.Substring($startIdx, $maxLen)

    if ($subscribeSlice -match $rxCacheWipe) {
        Write-Pass 'subscribeToWorldSnapshots callback clears admin_snapshots_list cache -- correct (keeps polling fallback consistent)'
    } else {
        Write-Warn 'subscribeToWorldSnapshots callback does NOT clear admin_snapshots_list -- polling fallback may serve stale data'
    }
} else {
    Write-Fail 'subscribeToWorldSnapshots function not found in firebase-service.js'
}

# ============================================================
# Check 11: forceSnapshotActiveState cache wipe (firebase-service.js)
# ============================================================
Write-Host "--- Check 11: Cache wipe in forceSnapshotActiveState ---" -ForegroundColor DarkCyan

$forceStatePattern = '(?s)async\s+function\s+forceSnapshotActiveState\s*\('
$forceStateMatch = [regex]::Match($firebaseServiceContent, $forceStatePattern)
if ($forceStateMatch.Success) {
    $startIdx = $forceStateMatch.Index
    $maxLen = [Math]::Min(1500, $firebaseServiceContent.Length - $startIdx)
    $forceStateSlice = $firebaseServiceContent.Substring($startIdx, $maxLen)

    if ($forceStateSlice -match $rxCacheWipe) {
        Write-Pass 'forceSnapshotActiveState clears admin_snapshots_list cache -- correct'
    } else {
        Write-Warn 'forceSnapshotActiveState does NOT clear admin_snapshots_list -- may cause UI/cache desync'
    }
} else {
    Write-Warn 'forceSnapshotActiveState function not found in firebase-service.js (may not be implemented yet)'
}

# ============================================================
# Check 12: deleteCurrentSnapshot — loadSnapshots call (informational)
# ============================================================
Write-Host "--- Check 12: loadSnapshots in deleteCurrentSnapshot (info) ---" -ForegroundColor DarkCyan

$deleteBody = Get-ToggleHandlerBody -Source $templatesMapContent -FunctionName "deleteCurrentSnapshot"

if ($null -ne $deleteBody) {
    if ($deleteBody -match $rxLoadSnapshots) {
        Write-Warn 'deleteCurrentSnapshot calls loadSnapshots -- acceptable as fallback, but onSnapshot should handle re-render automatically. Consider removing if listener is reliable'
    } else {
        Write-Pass 'deleteCurrentSnapshot does NOT call loadSnapshots -- relies on onSnapshot listener'
    }
} else {
    Write-Warn 'Could not locate window.deleteCurrentSnapshot handler -- skipped'
}

# ============================================================
# Summary
# ============================================================
Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan

$total = $passCount + $warnCount + $failCount
Write-Host "  Total checks : $total" -ForegroundColor White
Write-Host "  Passed       : $passCount" -ForegroundColor Green

if ($warnCount -gt 0) {
    Write-Host "  Warnings     : $warnCount" -ForegroundColor Yellow
} else {
    Write-Host "  Warnings     : 0" -ForegroundColor White
}

if ($failCount -gt 0) {
    Write-Host "  Failed       : $failCount" -ForegroundColor Red
} else {
    Write-Host "  Failed       : 0" -ForegroundColor White
}

Write-Host ""

if ($failCount -eq 0 -and $warnCount -eq 0) {
    Write-Host "  ALL CHECKS PASSED -- no toggle re-render or cache wipe issues" -ForegroundColor Green
} elseif ($failCount -eq 0) {
    Write-Host "  ALL CRITICAL CHECKS PASSED (warnings need attention)" -ForegroundColor Yellow
} else {
    Write-Host "  SOME CHECKS FAILED -- toggle logic may cause double re-renders or stale cache" -ForegroundColor Red
}

Write-Host "===============" -ForegroundColor Cyan
