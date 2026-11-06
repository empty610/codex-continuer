param([switch]$Disable, [string]$PluginRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$continuerRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$continuerName = 'CodexContinuer'
$continuerNode = (Get-Command node -ErrorAction Stop).Source
$continuerRoot = [IO.Path]::GetFullPath($PluginRoot)
$continuerWatcher = Join-Path $continuerRoot 'desktop/watch-codex.ps1'
# Resolve before creating directories, using the same rules as every runtime.
# Base64 preserves Unicode paths across Windows PowerShell console encodings.
$continuerEncodedData = & $continuerNode '-e' 'process.stdout.write(Buffer.from(require(process.argv[1]).dataDir, ''utf16le'').toString(''base64''))' (Join-Path $continuerRoot 'server/config.cjs')
if ($LASTEXITCODE -ne 0 -or -not $continuerEncodedData) { throw 'Could not resolve the Continuer data directory.' }
$continuerData = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($continuerEncodedData))
New-Item -ItemType Directory -Path $continuerData -Force | Out-Null
$continuerRegistryKey = Get-Item -LiteralPath $continuerRegistry -ErrorAction SilentlyContinue
$continuerExisting = if ($continuerRegistryKey) { $continuerRegistryKey.GetValue($continuerName, $null) } else { $null }
if ($continuerExisting -and $continuerExisting -notmatch 'desktop[\\/]watch-codex\.ps1') { throw 'An unrelated startup item already uses the CodexContinuer name.' }
$continuerShell = New-Object -ComObject WScript.Shell
$continuerStartup = $continuerShell.SpecialFolders.Item('Startup')
$continuerShortcutPath = Join-Path $continuerStartup 'CodexContinuer.lnk'
$continuerShortcut = $continuerShell.CreateShortcut($continuerShortcutPath)
if ((Test-Path -LiteralPath $continuerShortcutPath) -and $continuerShortcut.Description -ne 'Codex Continuer startup') { throw 'An unrelated startup shortcut already uses the CodexContinuer name.' }
# Stop only the previous watcher identified by its saved PID and executable/script.
$continuerStatusPath = Join-Path $continuerData 'autostart-status.json'
if (Test-Path -LiteralPath $continuerStatusPath) {
    try {
        $continuerSaved = Get-Content -LiteralPath $continuerStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$continuerSaved.pid)"
        $continuerLegacy = $continuerProcess -and $continuerProcess.Name -eq 'powershell.exe' -and $continuerProcess.CommandLine.Contains((Join-Path $continuerSaved.pluginRoot 'desktop/watch-codex.ps1'))
        $continuerNative = $continuerProcess -and $continuerProcess.Name -eq 'continuer-monitor.exe' -and $continuerProcess.ExecutablePath -eq (Join-Path $continuerSaved.pluginRoot 'desktop/continuer-monitor.exe') -and $continuerProcess.CommandLine -match '(?:^|\s)"?--watch"?(?:\s|$)'
        if ($continuerLegacy -or $continuerNative) { Stop-Process -Id $continuerProcess.ProcessId }
    } catch { Write-Warning 'Could not stop the previous watcher. Its single-instance lock prevents duplicate watchers.' }
}
if ($Disable) {
    if ($continuerExisting) { Remove-ItemProperty -Path $continuerRegistry -Name $continuerName }
    if (Test-Path -LiteralPath $continuerShortcutPath) { Remove-Item -LiteralPath $continuerShortcutPath -Force }
    @{ enabled = $false; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $continuerData 'autostart-preferences.json') -Encoding UTF8
    Write-Host 'Continuer startup disabled. Existing project work is unchanged.'
    exit 0
}
if (-not (Test-Path -LiteralPath $continuerWatcher)) { throw 'Build/install the plugin before enabling startup.' }
$continuerPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$continuerArguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}" -PluginRoot "{2}" -DataDir "{3}"' -f $continuerWatcher,$continuerNode,$continuerRoot,$continuerData
# Startup shortcuts support the full argument list; Run values have a short
# command-line limit that long plugin/data paths exceed.
New-Item -ItemType Directory -Path $continuerStartup -Force | Out-Null
$continuerShortcut.TargetPath = $continuerPowerShell
$continuerShortcut.Arguments = $continuerArguments
$continuerShortcut.WorkingDirectory = $continuerRoot
$continuerShortcut.Description = 'Codex Continuer startup'
$continuerShortcut.WindowStyle = 7
$continuerShortcut.Save()
if (-not (Test-Path -LiteralPath $continuerShortcutPath)) { throw 'Could not save the startup shortcut.' }
if ($continuerExisting) { Remove-ItemProperty -Path $continuerRegistry -Name $continuerName }
# Explicit enable is a new user request; passive Codex launches still leave the
# exit latch intact until the user enables startup or opens Continuer manually.
$continuerQuit = Join-Path $continuerData 'quit.request'
if (Test-Path -LiteralPath $continuerQuit) { Remove-Item -LiteralPath $continuerQuit -Force }
@{ enabled = $true; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $continuerData 'autostart-preferences.json') -Encoding UTF8
Start-Process -FilePath $continuerPowerShell -ArgumentList $continuerArguments -WindowStyle Hidden | Out-Null
Write-Host 'Startup registered for the current user. Watcher launch requested; open Continuer to check its status.'
