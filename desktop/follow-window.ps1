param([Parameter(Mandatory=$true)][int]$WidgetPid)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'codex-windows.cs')
[ContinuerWindows]::Track($WidgetPid)
