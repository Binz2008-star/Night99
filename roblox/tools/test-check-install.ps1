# Fault-injection test for tools/check-install.mjs.
#
# A checker that only ever passes is worthless. This corrupts the generated
# installers six ways, asserts check-install.mjs fails each time, then restores.

param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$generated = Join-Path $root "generated"
$file = Join-Path $generated "InstallNight99.lua"
$partsDir = Join-Path $generated "install-parts"
$backupDir = Join-Path $generated ".install-backup"

function Invoke-Checker {
    # The checker reports failures on stderr; let that through instead of letting
    # PowerShell turn it into a terminating error.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & node (Join-Path $root "tools\check-install.mjs") 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return @{ Code = $code; Out = $out }
}

if (-not (Test-Path $file)) {
    Write-Host "generated/InstallNight99.lua is missing. Run `npm run build` first." -ForegroundColor Red
    exit 1
}

# Back up both forms so we can always put them back.
if (Test-Path $backupDir) { Remove-Item $backupDir -Recurse -Force }
New-Item -ItemType Directory -Force $backupDir | Out-Null
Copy-Item $file $backupDir -Force
Copy-Item $partsDir (Join-Path $backupDir "install-parts") -Recurse -Force

$original = Get-Content $file -Raw

function Restore {
    Copy-Item (Join-Path $backupDir "InstallNight99.lua") $file -Force
    if (Test-Path $partsDir) { Remove-Item $partsDir -Recurse -Force }
    Copy-Item (Join-Path $backupDir "install-parts") $partsDir -Recurse -Force
}

# Never corrupt a good baseline: if the installers are already dirty, regenerating
# is the fix, not mutating them further.
$baseline = Invoke-Checker
if ($baseline.Code -ne 0) {
    Write-Host "Baseline installers already fail:" -ForegroundColor Red
    Write-Host $baseline.Out
    Remove-Item $backupDir -Recurse -Force
    Write-Host "Run `npm run build` first." -ForegroundColor Red
    exit 1
}

$script:anyFailed = $false

function Test-Fault {
    param([string]$Name, [scriptblock]$Mutate, [string]$Expect)

    Restore
    & $Mutate

    $result = Invoke-Checker
    if ($result.Code -ne 0 -and $result.Out -match $Expect) {
        Write-Host "  OK    $Name" -ForegroundColor Green
    } else {
        Write-Host "  FAIL  $Name  (exit=$($result.Code), matched=$($result.Out -match $Expect))" -ForegroundColor Red
        Write-Host $result.Out
        $script:anyFailed = $true
    }
}

Test-Fault "corrupt a source in the single-file installer" {
    $text = $original -replace '(\r?\n\tMax = )100,', '${1}999,'
    [System.IO.File]::WriteAllText($file, $text)
} "source differs for ReplicatedStorage\.Shared\.Config"

Test-Fault "wrong instance class" {
    $text = $original -replace '(?s)(path = \{ "ServerScriptService", "Night99", "Net" \},\r?\n\t\tclassName = )"ModuleScript"', '${1}"Script"'
    [System.IO.File]::WriteAllText($file, $text)
} "wrong class for ServerScriptService\.Night99\.Net"

Test-Fault "drop an entry from the single-file installer" {
    $text = [regex]::Replace($original, '(?s)\t\{\r?\n\t\tpath = \{ "ServerScriptService", "Night99", "NightService" \}.*?\t\},\r?\n', '', 1)
    [System.IO.File]::WriteAllText($file, $text)
} "InstallNight99\.lua: missing ServerScriptService\.Night99\.NightService"

Test-Fault "Luau-only += in the scaffolding" {
    $text = $original -replace 'createdCount = createdCount \+ 1', 'createdCount += 1'
    [System.IO.File]::WriteAllText($file, $text)
} "does not parse"

Test-Fault "delete one part file" {
    Remove-Item (Join-Path $partsDir "1-of-6.lua") -Force
} "no part covers"

Test-Fault "corrupt a source inside a part" {
    $p = Join-Path $partsDir "1-of-6.lua"
    $text = (Get-Content $p -Raw) -replace '(\r?\n\tMax = )100,', '${1}999,'
    [System.IO.File]::WriteAllText($p, $text)
} "source differs for ReplicatedStorage\.Shared\.Config"

# Always restore, then prove the restore worked.
Restore
$final = Invoke-Checker
Remove-Item $backupDir -Recurse -Force

Write-Host ""
if ($script:anyFailed) {
    Write-Host "fault injection FAILED" -ForegroundColor Red
    exit 1
}
if ($final.Code -ne 0) {
    Write-Host "Restored installers still fail:" -ForegroundColor Red
    Write-Host $final.Out
    exit 1
}

Write-Host $final.Out.Trim()
Write-Host "installers restored and clean." -ForegroundColor Green