param([switch]$Demo, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$continuerNode = (Get-Command node -ErrorAction Stop).Source
$continuerArguments = @((Join-Path $PSScriptRoot 'plugin/control.js'), 'url')
if ($Demo) { $continuerArguments += '--demo' }
$continuerUrl = & $continuerNode @continuerArguments
if ($LASTEXITCODE -ne 0) { throw 'Continuer startup failed. Check the data directory logs.' }
Write-Host ('Codex Continuer: ' + ($continuerUrl -split '#')[0])
if (-not $NoBrowser) { Start-Process $continuerUrl }
