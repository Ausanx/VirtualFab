$ErrorActionPreference = 'Stop'
# npm can preserve a different PowerShell edition's module search path.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Archive\Microsoft.PowerShell.Archive.psd1')
$repoPath = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $repoPath '.venv-solver\Scripts\python.exe'
$artifactPath = Join-Path $repoPath 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactPath | Out-Null

function Get-PinnedArchive($url, $target, $sha256) {
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $sha256) { return }
    $temporary = "$target.$([guid]::NewGuid()).partial"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temporary
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $sha256) {
            throw "Archive checksum mismatch: $target"
        }
        Move-Item -LiteralPath $temporary -Destination $target -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}

$blasArchive = Join-Path $artifactPath 'OpenBLAS-0.3.31-x64.zip'
Get-PinnedArchive 'https://github.com/OpenMathLib/OpenBLAS/releases/download/v0.3.31/OpenBLAS-0.3.31-x64.zip' $blasArchive 'E7595359700E8BB5A15C41AF1920850B1BE37078EB22813201B3D4BC5BD9227E'
$blasDirectory = Join-Path $artifactPath 'openblas-0.3.31'
Expand-Archive -LiteralPath $blasArchive -DestinationPath $blasDirectory -Force
$mathDll = Join-Path $blasDirectory 'win64\bin\libopenblas.dll'

$umfCommit = '20ecaabd6d689a02e70c0debbb781301243dbe96'
$umfArchive = Join-Path $artifactPath 'umfpack-source.zip'
Get-PinnedArchive "https://codeload.github.com/devsim/umfpack_lgpl/zip/$umfCommit" $umfArchive '49799860656038DE13DB8EF83D825A86552E0F59007F9367515E243BE87928C7'
$umfDirectory = Join-Path $artifactPath 'umfpack-source'
Expand-Archive -LiteralPath $umfArchive -DestinationPath $umfDirectory -Force

$licenseDirectory = Join-Path $artifactPath 'solver-licenses'
New-Item -ItemType Directory -Force -Path $licenseDirectory | Out-Null
foreach ($entry in @(
    @('https://raw.githubusercontent.com/OpenMathLib/OpenBLAS/v0.3.31/LICENSE', 'OpenBLAS-LICENSE.txt', '190B5A9C8D9723FE958AD33916BD7346D96FAB3C5EA90832BB02D854F620FCFF'),
    @('https://raw.githubusercontent.com/devsim/devsim/v2.11.0.rc5/NOTICE', 'DEVSIM-NOTICE.txt', '30D873CFDF37B0C2FBFABA9454F39B916C2E23685329E219D5BA7280EF95D4FD')
)) {
    $target = Join-Path $licenseDirectory $entry[1]
    Get-PinnedArchive $entry[0] $target $entry[2]
}
Copy-Item -LiteralPath (Join-Path $umfDirectory "umfpack_lgpl-$umfCommit\COPYING") -Destination (Join-Path $licenseDirectory 'UMFPACK-COPYING.txt')
Copy-Item -LiteralPath $umfArchive -Destination (Join-Path $licenseDirectory 'UMFPACK-source.zip')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD-PARTY.md') -Destination $licenseDirectory
$pythonLicense = & $pythonPath -c "import pathlib,sys; p=pathlib.Path(sys.base_prefix); print(p / ('LICENSE_PYTHON.txt' if (p / 'LICENSE_PYTHON.txt').exists() else 'LICENSE.txt'))"
Copy-Item -LiteralPath $pythonLicense -Destination (Join-Path $licenseDirectory 'Python-LICENSE.txt')
$pyinstallerLicense = & $pythonPath -c "from importlib.metadata import distribution; d=distribution('pyinstaller'); print(next(d.locate_file(f) for f in d.files if str(f).endswith('/licenses/COPYING.txt')))"
Copy-Item -LiteralPath $pyinstallerLicense -Destination (Join-Path $licenseDirectory 'PyInstaller-COPYING.txt')

Push-Location $repoPath
try {
    & $pythonPath -m PyInstaller --noconfirm --onedir --name VirtualFabSolver --distpath solver-bin --workpath artifacts/solver-build --specpath artifacts/solver-build --collect-all devsim --copy-metadata devsim --add-binary "$mathDll;." --add-data "$licenseDirectory;licenses" solver/equilibrium.py
    if ($LASTEXITCODE -ne 0) { throw 'Solver build failed.' }
} finally {
    Pop-Location
}
