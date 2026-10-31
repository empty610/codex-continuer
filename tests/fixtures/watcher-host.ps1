param([string]$Watcher, [string]$NodePath, [string]$PluginRoot, [string]$DataDir)
$ErrorActionPreference = 'Stop'
# Only this child process gets a synthetic desktop and mutex. The original
# watcher runs unchanged; its child launcher is a read-only config probe.
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition 'public static class ContinuerWindows { public static string DesktopKey() { return "fixture-desktop"; } }'
function Add-Type { param($Path) if (-not $Path.EndsWith('codex-windows.cs')) { throw 'Unexpected type load' } }
function New-Object {
    $mutex = [pscustomobject]@{}
    $mutex | Add-Member -MemberType ScriptMethod -Name WaitOne -Value { param($timeout) return $true }
    $mutex | Add-Member -MemberType ScriptMethod -Name ReleaseMutex -Value {}
    $mutex | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
    return $mutex
}
function Start-Sleep { param($Seconds) Set-Content -LiteralPath (Join-Path $DataDir 'quit.request') -Value 'test complete' }
function Start-Process { throw 'No native watcher should be started by this fixture' }
$continuerOriginalData = $env:CONTINUER_DATA_DIR
& $Watcher -NodePath $NodePath -PluginRoot $PluginRoot -DataDir $DataDir
if ([string]$env:CONTINUER_DATA_DIR -ne [string]$continuerOriginalData) { throw 'Caller data environment was not restored' }
