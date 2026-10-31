param([Parameter(Mandatory=$true)][string]$PluginRoot, [Parameter(Mandatory=$true)][string]$DataDir, [ValidateSet('watcher','capture','service')][string]$Phase, [int]$ServicePid = 0, [switch]$ReadSnapshot)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$continuerRoot = [IO.Path]::GetFullPath($PluginRoot).TrimEnd('\')
function Test-ContinuerCommand($process, [string]$file) {
    return $process -and $process.CommandLine -and $process.CommandLine.Replace('/', '\').IndexOf($file.Replace('/', '\'), [StringComparison]::OrdinalIgnoreCase) -ge 0
}
if ($Phase -eq 'watcher') {
    $continuerStatusFile = Join-Path $DataDir 'autostart-status.json'
    if (-not (Test-Path -LiteralPath $continuerStatusFile)) { exit 0 }
    $continuerSaved = Get-Content -LiteralPath $continuerStatusFile -Raw | ConvertFrom-Json
    if (-not $continuerSaved.pid -or -not $continuerSaved.pluginRoot -or [IO.Path]::GetFullPath($continuerSaved.pluginRoot).TrimEnd('\') -ne $continuerRoot) { exit 0 }
    $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$continuerSaved.pid)"
    $continuerNative = $continuerProcess -and $continuerProcess.ExecutablePath -eq (Join-Path $continuerRoot 'desktop/continuer-monitor.exe') -and $continuerProcess.CommandLine -match '(?:^|\s)"?--watch"?(?:\s|$)'
    $continuerLegacy = $continuerProcess -and $continuerProcess.Name -eq 'powershell.exe' -and (Test-ContinuerCommand $continuerProcess (Join-Path $continuerRoot 'desktop/watch-codex.ps1'))
    if ($continuerNative -or $continuerLegacy) {
        $continuerLaunchers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($continuerProcess.ProcessId)" | Where-Object { $_.Name -eq 'node.exe' -and (Test-ContinuerCommand $_ (Join-Path $continuerRoot 'plugin/open.js')) })
        Stop-Process -Id $continuerProcess.ProcessId -ErrorAction SilentlyContinue
        foreach ($continuerLauncher in $continuerLaunchers) { Stop-Process -Id $continuerLauncher.ProcessId -ErrorAction SilentlyContinue }
    }
    exit 0
}
function Assert-ContinuerService($process) {
    if ($process.Name -notmatch '^(node|electron)\.exe$' -or -not (Test-ContinuerCommand $process (Join-Path $continuerRoot 'server/index.js'))) { throw 'Refusing to stop a process outside the selected Continuer installation.' }
}
function Get-ContinuerIdentity($process) {
    return [pscustomobject]@{ pid = [int]$process.ProcessId; created = $process.CreationDate.ToUniversalTime().Ticks.ToString(); executable = $process.ExecutablePath; command = $process.CommandLine }
}
function Stop-ContinuerTree([int]$processId) {
    & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $processId /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { throw 'Could not terminate the selected Continuer process tree.' }
}
if ($Phase -eq 'capture') {
    $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ServicePid"
    if (-not $continuerProcess) { Write-Output '[]'; exit 0 }
    Assert-ContinuerService $continuerProcess
    $continuerProcesses = @(Get-CimInstance Win32_Process)
    $continuerTree = [Collections.Generic.List[object]]::new()
    $continuerTree.Add($continuerProcess)
    for ($index = 0; $index -lt $continuerTree.Count; $index++) {
        $parent = $continuerTree[$index]
        foreach ($child in $continuerProcesses) {
            if ($child.ParentProcessId -eq $parent.ProcessId -and $child.CreationDate -ge $parent.CreationDate -and $child.ProcessId -notin $continuerTree.ProcessId) { $continuerTree.Add($child) }
        }
    }
    ConvertTo-Json -InputObject @($continuerTree | ForEach-Object { Get-ContinuerIdentity $_ }) -Compress
    exit 0
}
if ($Phase -eq 'service' -and $ServicePid -gt 0) {
    $continuerSnapshot = @()
    if ($ReadSnapshot) { $continuerSnapshot = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()) }
    if ($continuerSnapshot.Count -gt 0) {
        if ($continuerSnapshot[0].pid -ne $ServicePid) { throw 'Service snapshot identity mismatch.' }
        $continuerErrors = @()
        foreach ($saved in $continuerSnapshot) {
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$saved.pid)"
            if (-not $current) { continue }
            $identity = Get-ContinuerIdentity $current
            # A recycled PID must never target another application, even if its path matches.
            if ($identity.created -cne $saved.created -or $identity.executable -cne $saved.executable -or $identity.command -cne $saved.command) { continue }
            try { Stop-ContinuerTree $identity.pid } catch { $continuerErrors += $_.Exception.Message }
        }
        if ($continuerErrors.Count) { throw ($continuerErrors -join "`n") }
        exit 0
    }
    $continuerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ServicePid"
    if (-not $continuerProcess) { exit 0 }
    Assert-ContinuerService $continuerProcess
    # The root PID was verified above; terminate only its remaining process tree.
    Stop-ContinuerTree $ServicePid
}
