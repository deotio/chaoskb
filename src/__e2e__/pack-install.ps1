#
# E2E test: Pack & install simulation (T8) — Windows variant
#
# Simulates what a real user experiences after `npm install -g @deotio/chaoskb-client`.
#
# Exit 0 = pass, exit 1 = fail.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = Split-Path -Parent $ScriptDir
$Passed = 0
$Failed = 0
$TempDir = $null

function Pass($msg) {
    Write-Host "  PASS: $msg"
    $script:Passed++
}

function Fail($msg) {
    Write-Host "  FAIL: $msg"
    $script:Failed++
}

Write-Host ""
Write-Host "=== Pack & Install ==="

try {
    # 1. npm pack
    Set-Location $SrcDir
    $packOutput = npm pack --pack-destination $env:TEMP 2>&1
    $tarball = ($packOutput | Select-Object -Last 1).Trim()
    $tarballPath = Join-Path $env:TEMP $tarball

    if (Test-Path $tarballPath) {
        Pass "npm pack produced $tarball"
    } else {
        Fail "npm pack did not produce a tarball"
        Write-Host ""
        Write-Host "=== Results: $Passed passed, $Failed failed ==="
        exit 1
    }

    # 2. Install in temp directory
    $TempDir = Join-Path $env:TEMP "chaoskb-e2e-$(Get-Random)"
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    Set-Location $TempDir
    npm init -y --silent 2>&1 | Out-Null
    npm install $tarballPath --silent 2>&1 | Out-Null

    $binPath = Join-Path $TempDir "node_modules\.bin\chaoskb-mcp.cmd"
    if (Test-Path $binPath) {
        Pass "chaoskb-mcp.cmd installed in node_modules\.bin"
    } else {
        Fail "chaoskb-mcp.cmd not found in node_modules\.bin"
    }

    # Note: The CLI enters MCP server mode when stdin is not a TTY.
    # On Windows in CI, use cmd /c to get a pseudo-TTY environment.
    $entryJs = Join-Path $TempDir "node_modules\@deotio\chaoskb-client\dist\cli\index.js"

    # 3. Run --help
    try {
        $helpOutput = cmd /c "node `"$entryJs`" --help" 2>&1
        $helpText = $helpOutput -join "`n"
        if ($helpText -match "usage|chaoskb|commands|options") {
            Pass "--help prints usage information"
        } else {
            Fail "--help did not print recognizable usage info"
        }
    } catch {
        Fail "--help threw an error: $_"
    }

    # 4. Run --version
    try {
        $versionOutput = cmd /c "node `"$entryJs`" --version" 2>&1
        $versionText = ($versionOutput -join "").Trim()
        $expectedVersion = (Get-Content (Join-Path $SrcDir "package.json") | ConvertFrom-Json).version
        if ($versionText -match [regex]::Escape($expectedVersion)) {
            Pass "--version prints $expectedVersion"
        } else {
            Fail "--version output '$versionText' does not contain expected '$expectedVersion'"
        }
    } catch {
        Fail "--version threw an error: $_"
    }

    # 5. Verify registry.json is included
    $registryPath = Join-Path $TempDir "node_modules\@deotio\chaoskb-client\dist\cli\agent-registry\registry.json"
    if (Test-Path $registryPath) {
        Pass "registry.json included in package"
    } else {
        Fail "registry.json not found in installed package"
    }
} finally {
    if ($TempDir -and (Test-Path $TempDir)) {
        Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "=== Results: $Passed passed, $Failed failed ==="
if ($Failed -gt 0) { exit 1 }
