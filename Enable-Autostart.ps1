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
# Stop only the previous watcher identified by its saved PID and executable/script.
$continuerStatusPath = Join-Path $continuerData 'autostart-status.json'
if (Test-Path -LiteralPath $continuerStatusPath) {
    try {
        $continuerSaved = Get-Content -LiteralPath $continuerStatusPath -Raw | ConvertFrom-Json
        $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$continuerSaved.pid)"
        $continuerLegacy = $continuerProcess -and $continuerProcess.Name -eq 'powershell.exe' -and $continuerProcess.CommandLine.Contains((Join-Path $continuerSaved.pluginRoot 'desktop/watch-codex.ps1'))
        $continuerNative = $continuerProcess -and $continuerProcess.Name -eq 'continuer-monitor.exe' -and $continuerProcess.ExecutablePath -eq (Join-Path $continuerSaved.pluginRoot 'desktop/continuer-monitor.exe') -and $continuerProcess.CommandLine -match '(?:^|\s)"?--watch"?(?:\s|$)'
        if ($continuerLegacy -or $continuerNative) { Stop-Process -Id $continuerProcess.ProcessId }
    } catch { Write-Warning 'Could not stop the previous watcher. Its single-instance lock prevents duplicate watchers.' }
}
if ($Disable) {
    if ($continuerExisting) { Remove-ItemProperty -Path $continuerRegistry -Name $continuerName }
    @{ enabled = $false; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $continuerData 'autostart-preferences.json') -Encoding UTF8
    Write-Host 'Continuer startup disabled. Existing project work is unchanged.'
    exit 0
}
if (-not (Test-Path -LiteralPath $continuerWatcher)) { throw 'Build/install the plugin before enabling startup.' }
$continuerPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$continuerArguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}" -PluginRoot "{2}" -DataDir "{3}"' -f $continuerWatcher,$continuerNode,$continuerRoot,$continuerData
if (-not (Test-Path -LiteralPath $continuerRegistry)) { New-Item -Path $continuerRegistry -Force | Out-Null }
New-ItemProperty -Path $continuerRegistry -Name $continuerName -Value ('"' + $continuerPowerShell + '" ' + $continuerArguments) -PropertyType String -Force | Out-Null
@{ enabled = $true; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $continuerData 'autostart-preferences.json') -Encoding UTF8
Start-Process -FilePath $continuerPowerShell -ArgumentList $continuerArguments -WindowStyle Hidden | Out-Null
Write-Host 'Enabled for the current user: Continuer opens whenever Codex desktop starts.'
