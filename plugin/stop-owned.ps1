param([Parameter(Mandatory=$true)][string]$PluginRoot, [Parameter(Mandatory=$true)][string]$DataDir, [ValidateSet('watcher','service')][string]$Phase, [int]$ServicePid = 0)
$ErrorActionPreference = 'Stop'
$continuerRoot = [IO.Path]::GetFullPath($PluginRoot).TrimEnd('\')
function Test-ContinuerCommand($process, [string]$file) {
    return $process -and $process.CommandLine -and $process.CommandLine.Replace('/', '\').IndexOf($file.Replace('/', '\'), [StringComparison]::OrdinalIgnoreCase) -ge 0
}
if ($Phase -eq 'watcher') {
    $continuerStatusFile = Join-Path $DataDir 'autostart-status.json'
    if (-not (Test-Path -LiteralPath $continuerStatusFile)) { exit 0 }
    $continuerSaved = Get-Content -LiteralPath $continuerStatusFile -Raw | ConvertFrom-Json
    if (-not $continuerSaved.pid -or -not $continuerSaved.pluginRoot -or [IO.Path]::GetFullPath($continuerSaved.pluginRoot).TrimEnd('\') -ne $continuerRoot) { exit 0 }
    $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$continuerSaved.pid)" -ErrorAction SilentlyContinue
    $continuerNative = $continuerProcess -and $continuerProcess.ExecutablePath -eq (Join-Path $continuerRoot 'desktop/continuer-monitor.exe') -and $continuerProcess.CommandLine -match '(?:^|\s)"?--watch"?(?:\s|$)'
    $continuerLegacy = $continuerProcess -and $continuerProcess.Name -eq 'powershell.exe' -and (Test-ContinuerCommand $continuerProcess (Join-Path $continuerRoot 'desktop/watch-codex.ps1'))
    if ($continuerNative -or $continuerLegacy) {
        $continuerLaunchers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($continuerProcess.ProcessId)" | Where-Object { $_.Name -eq 'node.exe' -and (Test-ContinuerCommand $_ (Join-Path $continuerRoot 'plugin/open.js')) })
        Stop-Process -Id $continuerProcess.ProcessId -ErrorAction SilentlyContinue
        foreach ($continuerLauncher in $continuerLaunchers) { Stop-Process -Id $continuerLauncher.ProcessId -ErrorAction SilentlyContinue }
    }
    exit 0
}
if ($Phase -eq 'service' -and $ServicePid -gt 0) {
    $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ServicePid" -ErrorAction SilentlyContinue
    if (-not $continuerProcess) { exit 0 }
    if ($continuerProcess.Name -notmatch '^(node|electron)\.exe$' -or -not (Test-ContinuerCommand $continuerProcess (Join-Path $continuerRoot 'server/index.js'))) { throw 'Refusing to stop a process outside the selected Continuer installation.' }
    # The root PID was verified above; terminate only its remaining process tree.
    & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $ServicePid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $ServicePid -ErrorAction SilentlyContinue)) { throw 'Could not terminate the selected Continuer service.' }
}
