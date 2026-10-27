param([switch]$Demo, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$continuerNode = (Get-Command node -ErrorAction Stop).Source
$continuerArguments = @((Join-Path $PSScriptRoot 'plugin/control.js'), $(if ($NoBrowser) { 'start' } else { 'open' }))
if ($Demo) { $continuerArguments += '--demo' }
& $continuerNode @continuerArguments
if ($LASTEXITCODE -ne 0) { throw 'Continuer startup failed. Check the data directory logs.' }
