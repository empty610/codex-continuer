param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$PluginRoot, [Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference = 'Stop'
$continuerNative = Join-Path $PSScriptRoot 'continuer-monitor.exe'
if (Test-Path -LiteralPath $continuerNative) {
    # Keep existing Windows startup entries working while the bootstrap exits.
    $continuerArguments = (@('--watch', $NodePath, $PluginRoot, $DataDir) | ForEach-Object { '"' + ($_ -replace '(\\+)$', '$1$1') + '"' }) -join ' '
    Start-Process -FilePath $continuerNative -ArgumentList $continuerArguments -WindowStyle Hidden | Out-Null
    exit 0
}
$continuerMutex = New-Object System.Threading.Mutex($false, 'Local\CodexContinuerStartupWatcher')
try { $continuerAcquired = $continuerMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $continuerAcquired = $true }
if (-not $continuerAcquired) { $continuerMutex.Dispose(); exit 0 }
$continuerStatusPath = Join-Path $DataDir 'autostart-status.json'
$continuerLaunchPath = Join-Path $PluginRoot 'plugin/open.js'
$continuerSeen = ''
$continuerRetryAt = [DateTime]::MinValue
function Write-ContinuerStartupStatus($status, $message) {
    @{ pid=$PID; state=$status; message=$message; updatedAt=[DateTime]::UtcNow.ToString('o'); pluginRoot=$PluginRoot } | ConvertTo-Json -Compress | Set-Content -LiteralPath $continuerStatusPath -Encoding UTF8
}
try {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Add-Type -Path (Join-Path $PSScriptRoot 'codex-windows.cs')
    Write-ContinuerStartupStatus 'watching' 'Waiting for Codex desktop'
    while ($true) {
        if (Test-Path -LiteralPath (Join-Path $DataDir 'quit.request')) { Write-ContinuerStartupStatus 'stopped' 'Continuer exited by user'; break }
        try {
            # Inspect only native desktop windows, not every Electron child.
            $continuerKey = [ContinuerWindows]::DesktopKey()
            if (-not $continuerKey) {
                if ($continuerSeen) { $continuerSeen = ''; Write-ContinuerStartupStatus 'watching' 'Codex desktop closed; waiting for next launch' }
            } elseif ($continuerKey -ne $continuerSeen -and [DateTime]::UtcNow -ge $continuerRetryAt) {
                # Run inside this already-hidden console; LASTEXITCODE is reliable in Windows PowerShell 5.1.
                & $NodePath $continuerLaunchPath '--auto' 1> (Join-Path $DataDir 'autostart-launch.log') 2> (Join-Path $DataDir 'autostart-error.log')
                if ($LASTEXITCODE -ne 0) { throw 'Widget startup failed; see autostart-error.log' }
                $continuerSeen = $continuerKey
                Write-ContinuerStartupStatus 'launched' 'Widget started for Codex desktop'
            }
        } catch {
            $continuerRetryAt = [DateTime]::UtcNow.AddSeconds(30)
            Write-ContinuerStartupStatus 'retrying' $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }
} finally { $continuerMutex.ReleaseMutex(); $continuerMutex.Dispose() }
