$content = Get-Content 'd:\Project\FightCraft\www\core\index.html' -Raw
$injected = Get-Content 'd:\Project\FightCraft\www\auth-ui\character-selection-ui.html' -Raw
$combined = $content + $injected

$regex = [regex]'id="([^"]+)"'
$allMatches = $regex.Matches($combined)
$ids = @()
foreach ($m in $allMatches) {
    $ids += $m.Groups[1].Value
}

$groups = $ids | Group-Object | Where-Object { $_.Count -gt 1 }
if ($groups) {
    foreach ($g in $groups) {
        Write-Host "DUPLICATE: $($g.Name) (count: $($g.Count))"
    }
} else {
    Write-Host "No duplicate IDs found"
}
