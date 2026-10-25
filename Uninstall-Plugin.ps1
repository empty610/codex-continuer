$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Enable-Autostart.ps1') -Disable
if ($LASTEXITCODE -ne 0) { throw 'Could not disable autostart.' }
& node (Join-Path $PSScriptRoot 'plugin/control.js') stop
if ($LASTEXITCODE -ne 0) { throw 'Stop the service before removing the plugin.' }
& node (Join-Path $PSScriptRoot 'plugin/close.js')
if ($LASTEXITCODE -ne 0) { throw 'Could not close the widget.' }
& codex plugin remove codex-continuer@continuer-local
if ($LASTEXITCODE -ne 0) { throw 'Could not remove the plugin registration.' }
Write-Host 'Continuer removed. Task data is preserved in its configured data directory.'
