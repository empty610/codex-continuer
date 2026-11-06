param([string]$Script, [string]$PluginRoot, [string]$Trace, [switch]$Disable, [int]$WatcherPid = 0, [switch]$ExistingRegistry, [switch]$StopOnly, [string]$DataDir, [string]$ProcessRoot)
$ErrorActionPreference = 'Stop'
# Execute the complete installer with OS boundaries mocked. File writes stay in
# the isolated fixture; registry and background launch operations are recorded.
function Get-Item {
    param($LiteralPath, $ErrorAction)
    if ($LiteralPath -notlike 'HKCU:*') { throw 'Unexpected Get-Item' }
    if (-not $ExistingRegistry) { return $null }
    $item = [pscustomobject]@{}
    $item | Add-Member ScriptMethod GetValue { param($name,$fallback) return 'powershell.exe desktop\watch-codex.ps1' }
    return $item
}
function Test-Path {
    param($LiteralPath, $Path)
    $candidate = if ($LiteralPath) { $LiteralPath } else { $Path }
    if ($candidate -like 'HKCU:*') { return $true }
    return Microsoft.PowerShell.Management\Test-Path -LiteralPath $candidate
}
function New-ItemProperty { param($Path, $Name, $Value, $PropertyType, [switch]$Force) Add-Content -LiteralPath $Trace -Value ('registry:' + $Value) }
function Remove-ItemProperty { param($Path,$Name) if (-not $ExistingRegistry) { throw 'Unexpected registry removal' }; Add-Content -LiteralPath $Trace -Value 'registry-removed' }
function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) Add-Content -LiteralPath $Trace -Value ('launch:' + $ArgumentList) }
function Get-CimInstance {
    param($ClassName,$Filter)
    if (-not $WatcherPid) { throw 'Unexpected process inspection' }
    if ($Filter -like 'ParentProcessId=*') { return @() }
    if ($Filter -ne "ProcessId=$WatcherPid") { throw 'Unexpected PID' }
    Add-Content -LiteralPath $Trace -Value 'query'
    $processPluginRoot = if ($ProcessRoot) { $ProcessRoot } else { $PluginRoot }
    return [pscustomobject]@{ ProcessId=$WatcherPid; Name='continuer-monitor.exe'; ExecutablePath=(Join-Path $processPluginRoot 'desktop/continuer-monitor.exe'); CommandLine='fixture --watch' }
}
function Stop-Process { param($Id,$ErrorAction) if ($Id -ne $WatcherPid) { throw 'Unexpected stop' }; Add-Content -LiteralPath $Trace -Value 'stop' }
function New-Object {
    param($ComObject)
    if ($ComObject -ne 'WScript.Shell') { throw 'Unexpected COM object' }
    $folders = [pscustomobject]@{ Root = (Join-Path $PluginRoot 'fixture-startup') }
    $folders | Add-Member ScriptMethod Item { param($name) if ($name -ne 'Startup') { throw 'Unexpected folder' }; return $this.Root }
    $shell = [pscustomobject]@{ SpecialFolders = $folders }
    $shell | Add-Member ScriptMethod CreateShortcut {
        param($path)
        $shortcut = [pscustomobject]@{ Path=$path; TargetPath=''; Arguments=''; WorkingDirectory=''; Description=''; WindowStyle=0 }
        if (Test-Path -LiteralPath $path) {
            $saved = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($name in @('TargetPath','Arguments','WorkingDirectory','Description','WindowStyle')) { $shortcut.$name = $saved.$name }
        }
        $shortcut | Add-Member ScriptMethod Save {
            $this | ConvertTo-Json | Set-Content -LiteralPath $this.Path -Encoding UTF8
            Add-Content -LiteralPath $Trace -Value ('shortcut:' + $this.Arguments)
        }
        return $shortcut
    }
    return $shell
}
if ($StopOnly) { & $Script -PluginRoot $PluginRoot -DataDir $DataDir -Phase watcher }
else { & $Script -PluginRoot $PluginRoot -Disable:$Disable }
