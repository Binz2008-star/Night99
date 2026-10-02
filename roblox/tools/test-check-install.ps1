# Fault-injection test for tools/check-install.mjs.
#
# A checker that only ever passes is worthless. This corrupts the generated
# installer four ways, asserts check-install.mjs fails each time, then restores.

param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root "generated\InstallNight99.lua"
$backup = Join-Path $root "generated\InstallNight99.lua.bak"

if (-not (Test-Path $file)) {
    Write-Host "generated/InstallNight99.lua is missing. Run `npm run build` first." -ForegroundColor Red
    exit 1
}

Copy-Item $file $backup -Force
$original = Get-Content $backup -Raw

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

# Never corrupt a good baseline: if the installer is already dirty, regenerating
# is the fix, not mutating it further.
$baseline = Invoke-Checker
if ($baseline.Code -ne 0) {
    Write-Host "Baseline installer already fails:" -ForegroundColor Red
    Write-Host $baseline.Out
    Remove-Item $backup -Force
    Write-Host "Run `npm run build` first." -ForegroundColor Red
    exit 1
}

function Test-Fault {
    param([string]$Name, [scriptblock]$Mutate, [string]$Expect)

    $text = $original
    & $Mutate ([ref]$text)
    [System.IO.File]::WriteAllText($file, $text)

    $result = Invoke-Checker
    if ($result.Code -ne 0 -and $result.Out -match $Expect) {
        Write-Host "  OK    $Name" -ForegroundColor Green
    } else {
        Write-Host "  FAIL  $Name  (exit=$($result.Code), matched=$($result.Out -match $Expect))" -ForegroundColor Red
        Write-Host $result.Out
        $script:anyFailed = $true
    }
}

$script:anyFailed = $false

Test-Fault "corrupt one embedded source" {
    param($r)
    $r.Value = $r.Value -replace '(\r?\n\tMax = )100,', '${1}999,'
} "source differs for ReplicatedStorage\.Shared\.Config"

Test-Fault "wrong instance class" {
    param($r)
    $r.Value = $r.Value -replace '(?s)(path = \{ "ServerScriptService", "Night99", "Net" \},\r?\n\t\tclassName = )"ModuleScript"', '${1}"Script"'
} "wrong class for ServerScriptService\.Night99\.Net"

Test-Fault "drop an entry entirely" {
    param($r)
    $r.Value = [regex]::Replace($r.Value, '(?s)\t\{\r?\n\t\tpath = \{ "ServerScriptService", "Night99", "NightService" \}.*?\t\},\r?\n', '', 1)
} "missing from the installer: ServerScriptService\.Night99\.NightService"

Test-Fault "Luau-only += in the scaffolding" {
    param($r)
    $r.Value = $r.Value -replace 'createdCount = createdCount \+ 1', 'createdCount += 1'
} "does not parse"

# Always restore, even if something above threw.
[System.IO.File]::WriteAllText($file, $original)
Remove-Item $backup -Force

Write-Host ""
if ($script:anyFailed) {
    Write-Host "fault injection FAILED" -ForegroundColor Red
    exit 1
}

$final = Invoke-Checker
if ($final.Code -ne 0) {
    Write-Host "Restored installer still fails:" -ForegroundColor Red
    Write-Host $final.Out
    exit 1
}

Write-Host $final.Out.Trim()
Write-Host "installer restored and clean." -ForegroundColor Green