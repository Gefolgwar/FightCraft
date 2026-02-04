# Deploy Firebase Security Rules
# This script updates Firestore security rules to support character subcollections

Write-Host "🔐 Deploying Firebase Security Rules..." -ForegroundColor Cyan
Write-Host ""

# Check if Firebase CLI is installed
$firebaseInstalled = Get-Command firebase -ErrorAction SilentlyContinue

if (-not $firebaseInstalled) {
    Write-Host "❌ Firebase CLI not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install with:" -ForegroundColor Yellow
    Write-Host "npm install -g firebase-tools" -ForegroundColor White
    Write-Host ""
    Write-Host "Then login:" -ForegroundColor Yellow
    Write-Host "firebase login" -ForegroundColor White
    exit 1
}

Write-Host "✅ Firebase CLI found" -ForegroundColor Green
Write-Host ""
Write-Host "Deploying rules to project: fight-craft-3c3f0" -ForegroundColor Yellow
Write-Host ""

# Deploy rules
firebase deploy --only firestore:rules --project fight-craft-3c3f0

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Security rules deployed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now:" -ForegroundColor Cyan
    Write-Host "  1. Create characters" -ForegroundColor White
    Write-Host "  2. Save to characters subcollection" -ForegroundColor White
    Write-Host "  3. Load characters list" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try:" -ForegroundColor Yellow
    Write-Host "  1. firebase login" -ForegroundColor White
    Write-Host "  2. firebase use fight-craft-3c3f0" -ForegroundColor White
    Write-Host "  3. Run this script again" -ForegroundColor White
    Write-Host ""
}
