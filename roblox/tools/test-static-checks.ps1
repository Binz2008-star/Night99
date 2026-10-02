# Fault-injection test for the two static checks that were added after a playtest:
#
#   tools/check-lua.mjs   -- Roblox datatypes passed to Instance.new
#   tools/check-refs.mjs  -- config.<Section>.<Field> paths that do not exist
#
# Both of these checks were written *after* the bug they catch had already shipped
# and been found by playing the game. A validator added in response to a real failure
# is exactly the kind that encodes the author's assumptions rather than the rules, so
# each one is corrupted here on purpose and must be made to fail. The Clean cases at
# the end matter just as much: a check that fires on correct code is a check people
# learn to skip.
#
#   pwsh -File tools/test-static-checks.ps1

param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $root "generated\.static-backup"

$luaChecker = Join-Path $root "tools\check-lua.mjs"
$refsChecker = Join-Path $root "tools\check-refs.mjs"

# Files we are willing to corrupt, and therefore must be able to put back.
$victims = @(
    "src\client\HUD.lua",
    "src\server\MonsterService.lua"
)

function Invoke-Checker {
    param([string]$Script)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & node $Script 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return @{ Code = $code; Out = $out }
}

foreach ($v in $victims) {
    if (-not (Test-Path (Join-Path $root $v))) {
        Write-Host "$v is missing." -ForegroundColor Red
        exit 1
    }
}

if (Test-Path $backupDir) { Remove-Item $backupDir -Recurse -Force }
New-Item -ItemType Directory -Force $backupDir | Out-Null
foreach ($v in $victims) {
    $dest = Join-Path $backupDir ($v -replace '\\', '__')
    Copy-Item (Join-Path $root $v) $dest -Force
}

function Restore {
    foreach ($v in $victims) {
        $src = Join-Path $backupDir ($v -replace '\\', '__')
        Copy-Item $src (Join-Path $root $v) -Force
    }
}

function Mutate {
    param([string]$Relative, [scriptblock]$Transform)
    $path = Join-Path $root $Relative
    $text = [System.IO.File]::ReadAllText($path)
    $new = & $Transform $text
    if ($new -eq $text) {
        Write-Host "  ABORT mutation was a no-op on $Relative -- the test would pass for the wrong reason." -ForegroundColor Red
        $script:anyFailed = $true
        return
    }
    [System.IO.File]::WriteAllText($path, $new)
}

$script:anyFailed = $false

function Test-Fault {
    param([string]$Name, [string]$Checker, [scriptblock]$Mutate, [string]$Expect)

    Restore
    & $Mutate
    $result = Invoke-Checker $Checker

    if ($result.Code -ne 0 -and $result.Out -match $Expect) {
        Write-Host "  OK    $Name" -ForegroundColor Green
    }
    else {
        Write-Host "  FAIL  $Name  (exit=$($result.Code), matched=$($result.Out -match $Expect))" -ForegroundColor Red
        Write-Host $result.Out
        $script:anyFailed = $true
    }
}

function Test-Clean {
    param([string]$Name, [string]$Checker, [scriptblock]$Mutate)

    Restore
    & $Mutate
    $result = Invoke-Checker $Checker

    if ($result.Code -eq 0) {
        Write-Host "  OK    $Name (no false positive)" -ForegroundColor Green
    }
    else {
        Write-Host "  FAIL  $Name flagged correct code:" -ForegroundColor Red
        Write-Host $result.Out
        $script:anyFailed = $true
    }
}

try {
    # --- refuse to run against an already-dirty baseline -----------------------
    $baseLua = Invoke-Checker $luaChecker
    $baseRefs = Invoke-Checker $refsChecker
    if ($baseLua.Code -ne 0 -or $baseRefs.Code -ne 0) {
        Write-Host "Baseline is not clean, so a fault could not be blamed on the fault:" -ForegroundColor Red
        Write-Host $baseLua.Out
        Write-Host $baseRefs.Out
        exit 1
    }

    # --- check-lua: datatypes vs Instances --------------------------------------
    Test-Fault "Instance.new given a datatype directly" $luaChecker {
        Mutate "src\client\HUD.lua" {
            param($t)
            # Must go *before* the final `return`, or the file fails to parse and the
            # test would pass because of a syntax error rather than the datatype check.
            $t.Replace("return HUD", "local _probe = Instance.new(`"UDim`", 0, 8)`r`nreturn HUD")
        }
    } "is a datatype, not an Instance"

    Test-Fault "helper forwards a datatype without dispatching it" $luaChecker {
        # Put HUD's new() back the way it was on the day it shipped the bug: a thin
        # Instance.new wrapper that everything routes through, datatypes included.
        Mutate "src\client\HUD.lua" {
            param($t)
            $dispatch = [regex]::Match($t, '(?s)local DATATYPE_CONSTRUCTORS = \{.*?\}\r?\n\r?\n').Value
            if (-not $dispatch) { throw "could not find the dispatch table in HUD.lua" }
            $t = $t.Replace($dispatch, "")
            $t = [regex]::Replace($t, '(?s)local function new\(className, \.\.\.\).*?\r?\nend\r?\n',
                @"
local function new(className, props, children)
`tlocal instance = Instance.new(className)
`tfor key, value in props do
`t`tinstance[key] = value
`tend
`tfor _, child in ipairs(children or {}) do
`t`tinstance:AddChild(child)
`tend
`treturn instance
end

"@)
            $t
        }
    } "does not dispatch"

    Test-Clean "helper that does dispatch a datatype" $luaChecker {
        Mutate "src\client\HUD.lua" {
            param($t)
            $t.Replace(
                "`tNumberSequenceKeypoint = NumberSequenceKeypoint.new,",
                "`tNumberSequenceKeypoint = NumberSequenceKeypoint.new,`r`n`tVector2int16 = Vector2int16.new,"
            ).Replace(
                "corner(elements.batteryFill, 4)",
                "corner(elements.batteryFill, 4)`r`n`tlocal _ok = new(`"Vector2int16`", 0, 4)"
            )
        }
    }

    Test-Clean "genuine Instance classes are not flagged" $luaChecker {
        Mutate "src\client\HUD.lua" {
            param($t)
            $t.Replace("return HUD",
                "local _probe = Instance.new(`"Frame`")`r`n" +
                "local _probe2 = new(`"UICorner`", { CornerRadius = UDim.new(0, 4) })`r`n" +
                "return HUD")
        }
    }

    # --- check-refs: Config paths ------------------------------------------------
    Test-Fault "field read from the wrong Config section" $refsChecker {
        # The real bug: HeightOffset lives under Config.Monster, not Config.Map.
        Mutate "src\server\MonsterService.lua" {
            param($t)
            $t.Replace("config.Monster.HeightOffset", "config.Map.Monster.HeightOffset")
        }
    } "Did you mean Monster\.HeightOffset\?"

    Test-Fault "Config section that does not exist" $refsChecker {
        Mutate "src\server\MonsterService.lua" {
            param($t)
            $t.Replace("config.Monster.AttackDamage", "config.Monste.AttackDamage")
        }
    } "reads Monste as a Config section"

    Test-Fault "field that does not exist inside a real section" $refsChecker {
        # MonsterService reads config.Monster.* and config.Map.*; config.Battery.Max
        # is not in this file, so replacing it there would be a silent no-op.
        Mutate "src\server\MonsterService.lua" {
            param($t)
            $t.Replace("config.Monster.AttackCooldown", "config.Monster.AttackCooldowns")
        }
    } "defines no such key"

    Test-Fault "nested read via a differently named Config alias" $refsChecker {
        # check-refs must follow `local cfg = require(...Config)`, not just the name
        # `config` -- otherwise a renamed alias silently opts out of validation.
        Mutate "src\server\MonsterService.lua" {
            param($t)
            $t.Replace(
                'local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))',
                'local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))' +
                "`r`nlocal cfg = Config"
            ).Replace("config.Monster.AttackRange", "cfg.Monster.AttackRang")
        }
    } "defines no such key"

    Test-Clean "correct nested path and alias both pass" $refsChecker {
        Mutate "src\server\MonsterService.lua" {
            param($t)
            $t.Replace(
                'local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))',
                'local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))' +
                "`r`nlocal cfg = Config"
            ).Replace("config.Monster.AttackRange", "cfg.Monster.AttackRange")
        }
    }

    # --- always restore, then prove the restore worked --------------------------
    Restore
    $finalLua = Invoke-Checker $luaChecker
    $finalRefs = Invoke-Checker $refsChecker
}
finally {
    Restore
    if (Test-Path $backupDir) { Remove-Item $backupDir -Recurse -Force }
}

Write-Host ""
if ($script:anyFailed) {
    Write-Host "static-check fault injection FAILED" -ForegroundColor Red
    exit 1
}
if ($finalLua.Code -ne 0 -or $finalRefs.Code -ne 0) {
    Write-Host "Restored sources still fail:" -ForegroundColor Red
    Write-Host $finalLua.Out
    Write-Host $finalRefs.Out
    exit 1
}

Write-Host "sources restored and clean; both checks reject every injected fault." -ForegroundColor Green
