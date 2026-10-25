param([string]$OutputPath = (Join-Path $PSScriptRoot '../desktop/continuer-monitor.exe'))
$ErrorActionPreference = 'Stop'
$continuerCompiler = $env:CONTINUER_CSC
if (-not $continuerCompiler) {
    $continuerLocator = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (Test-Path -LiteralPath $continuerLocator) { $continuerCompiler = & $continuerLocator -latest -products '*' -find 'MSBuild\Current\Bin\Roslyn\csc.exe' | Select-Object -First 1 }
}
if (-not $continuerCompiler -or -not (Test-Path -LiteralPath $continuerCompiler)) { throw 'Install Visual Studio Build Tools with MSBuild/Roslyn, or set CONTINUER_CSC to its csc.exe. The legacy .NET Framework compiler cannot produce deterministic builds.' }
$continuerOutput = [IO.Path]::GetFullPath($OutputPath)
$continuerDesktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../desktop'))
Push-Location $continuerDesktop
try { & $continuerCompiler /nologo /noconfig /nostdlib+ /deterministic+ /debug- /optimize+ /target:winexe /platform:anycpu "/pathmap:$continuerDesktop=/_/desktop" "/reference:$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\mscorlib.dll" "/reference:$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\System.dll" "/reference:$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\System.Core.dll" "/out:$continuerOutput" codex-windows.cs monitor.cs }
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Native desktop monitor compilation failed.' }
Write-Output "Built desktop monitor: $continuerOutput"
