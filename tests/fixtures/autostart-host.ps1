param([string]$Script, [string]$PluginRoot, [string]$Trace, [switch]$Disable)
$ErrorActionPreference = 'Stop'
# Execute the complete installer with OS boundaries mocked. File writes stay in
# the isolated fixture; registry and background launch operations are recorded.
function Get-Item { param($LiteralPath, $ErrorAction) if ($LiteralPath -notlike 'HKCU:*') { throw 'Unexpected Get-Item' }; return $null }
function Test-Path {
    param($LiteralPath, $Path)
    $candidate = if ($LiteralPath) { $LiteralPath } else { $Path }
    if ($candidate -like 'HKCU:*') { return $true }
    return Microsoft.PowerShell.Management\Test-Path -LiteralPath $candidate
}
function New-ItemProperty { param($Path, $Name, $Value, $PropertyType, [switch]$Force) Add-Content -LiteralPath $Trace -Value ('registry:' + $Value) }
function Remove-ItemProperty { throw 'No existing registry item should be removed in this fixture' }
function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) Add-Content -LiteralPath $Trace -Value ('launch:' + $ArgumentList) }
function Get-CimInstance { throw 'No process inspection should occur in this fixture' }
function Stop-Process { throw 'No process should be stopped in this fixture' }
& $Script -PluginRoot $PluginRoot -Disable:$Disable
