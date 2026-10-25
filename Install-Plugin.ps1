param([switch]$NoBuild, [switch]$NoOpen, [switch]$Autostart)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & node scripts/doctor.js --strict
    if ($LASTEXITCODE -ne 0) { throw 'Required Node/Codex capabilities are missing. See docs/compatibility.md.' }
    if (-not $NoBuild) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/electron/dist/electron.exe'))) {
            & npm.cmd ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
            & node node_modules/electron/install.js
            if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed.' }
        }
        & node scripts/build-plugin.js
        if ($LASTEXITCODE -ne 0) { throw 'Plugin build failed.' }
    }
    $continuerMarketplace = Join-Path $PSScriptRoot 'dist/marketplace'
    & codex plugin marketplace add $continuerMarketplace --json
    if ($LASTEXITCODE -ne 0) { throw 'Could not register the local marketplace.' }
    $continuerInstall = & codex plugin add 'codex-continuer@continuer-local' --json
    if ($LASTEXITCODE -ne 0) { throw 'Could not install Continuer.' }
    $continuerInstall
    $continuerInstalled = & codex plugin list --json
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the installed plugin.' }
    $continuerInstalled | ConvertFrom-Json | Select-Object -ExpandProperty installed | Where-Object { $_.pluginId -eq 'codex-continuer@continuer-local' } | ConvertTo-Json -Depth 6
    if ($Autostart) { & (Join-Path $PSScriptRoot 'Enable-Autostart.ps1') -PluginRoot ($continuerInstall | ConvertFrom-Json).installedPath }
    if (-not $NoOpen) { & node plugin/open.js }
    Write-Host 'Installed. Open a new Codex chat or reload plugins to use the Continuer tools.'
} finally { Pop-Location }
