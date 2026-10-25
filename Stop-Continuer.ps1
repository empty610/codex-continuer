param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$continuerArguments = @((Join-Path $PSScriptRoot 'plugin/control.js'), 'stop')
if ($Demo) { $continuerArguments += '--demo' }
& node @continuerArguments
if ($LASTEXITCODE -ne 0) { throw 'Could not stop Continuer. Check its port and data directory.' }
