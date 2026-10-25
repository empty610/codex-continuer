param([switch]$Autostart, [switch]$Open)
$ErrorActionPreference = 'Stop'
$continuerRoot = Join-Path $PSScriptRoot 'plugins/codex-continuer'
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.agents/plugins/marketplace.json'))) { throw 'Run this installer from the extracted portable marketplace root.' }
& node (Join-Path $continuerRoot 'scripts/verify-artifact.js') $continuerRoot
if ($LASTEXITCODE -ne 0) { throw 'Artifact verification failed.' }
& codex plugin marketplace add $PSScriptRoot --json
if ($LASTEXITCODE -ne 0) { throw 'Could not register the portable marketplace.' }
$continuerInstall = & codex plugin add 'codex-continuer@continuer-local' --json
if ($LASTEXITCODE -ne 0) { throw 'Could not install Continuer.' }
$continuerInstalled = ($continuerInstall | ConvertFrom-Json).installedPath
if ($Autostart) { & (Join-Path $continuerInstalled 'Enable-Autostart.ps1') }
if ($Open) { & node (Join-Path $continuerInstalled 'plugin/open.js'); if ($LASTEXITCODE -ne 0) { throw 'Widget startup failed.' } }
Write-Host 'Installed. Reload Codex plugins. Opening the widget does not enable scheduling.'
