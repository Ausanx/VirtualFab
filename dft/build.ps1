$ErrorActionPreference = 'Stop'
$dftPackage = Join-Path $PSScriptRoot '..\dft-bin\dft'
New-Item -ItemType Directory -Force -Path $dftPackage | Out-Null
foreach ($file in @('core.py', 'worker.py', 'pseudos.json', 'setup.ps1', 'install-qe.sh', 'THIRD-PARTY.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $dftPackage $file) -Force
}
Write-Output 'DFT adapter staged; Python caches and development modules are excluded.'
