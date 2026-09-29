$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
$setupCache = Join-Path $PSScriptRoot '..\artifacts\dft-setup'
$qeInstall = Join-Path $env:LOCALAPPDATA 'VirtualFab-QE'
New-Item -ItemType Directory -Force -Path $setupCache | Out-Null
$distributions = (& wsl --list --quiet) -replace "`0", ''
if ($LASTEXITCODE -ne 0) { throw 'Install WSL2 first: wsl --install --no-distribution' }
if ($distributions -notcontains 'VirtualFab-QE') {
    $rootfs = Join-Path $setupCache 'ubuntu-base.tar.gz'
    if (-not (Test-Path -LiteralPath $rootfs)) {
        & curl.exe -fL --retry 2 --max-time 600 -o $rootfs 'https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.5-base-amd64.tar.gz'
        if ($LASTEXITCODE -ne 0) { throw 'Ubuntu download failed' }
    }
    if ((Get-FileHash -LiteralPath $rootfs -Algorithm SHA256).Hash -ne 'E77B6F10C2590CEF872B33EE9F635A0E3FD1F57FB074C0E52B5C7F56147A0C86') { throw 'Ubuntu rootfs checksum mismatch' }
    & wsl --import VirtualFab-QE $qeInstall $rootfs --version 2
    if ($LASTEXITCODE -ne 0) { throw 'WSL import failed' }
}
& wsl -d VirtualFab-QE -u root --exec apt-get update
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu package index update failed' }
& wsl -d VirtualFab-QE -u root --exec env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-ase python3-spglib ca-certificates curl git gfortran make m4 libfftw3-dev libopenblas-dev
if ($LASTEXITCODE -ne 0) { throw 'QE/ASE installation failed' }
& wsl -d VirtualFab-QE -u root --exec mkdir -p /opt/virtualfab/pseudo
if ($LASTEXITCODE -ne 0) { throw 'Cannot create pseudopotential directory' }
$pseudos = Get-Content (Join-Path $PSScriptRoot 'pseudos.json') -Raw | ConvertFrom-Json
foreach ($element in $pseudos.PSObject.Properties) {
    $pseudo = $element.Value
    $cachedPseudo = Join-Path $setupCache "$($element.Name).UPF"
    if (-not (Test-Path -LiteralPath $cachedPseudo)) {
        & curl.exe -fL --retry 2 --max-time 300 -o $cachedPseudo $pseudo.url
        if ($LASTEXITCODE -ne 0) { throw "Pseudopotential download failed: $($element.Name)" }
    }
    if ((Get-FileHash -LiteralPath $cachedPseudo -Algorithm SHA256).Hash -ne $pseudo.sha256) { throw "Pseudopotential checksum mismatch: $($element.Name)" }
    $linuxPseudo = (& wsl -d VirtualFab-QE -u root --exec wslpath -a -u (Resolve-Path $cachedPseudo).Path).Trim()
    & wsl -d VirtualFab-QE -u root --exec cp $linuxPseudo "/opt/virtualfab/pseudo/$($pseudo.file)"
    if ($LASTEXITCODE -ne 0) { throw 'Pseudopotential copy failed' }
}
$qeSource = Join-Path (Split-Path $setupCache -Parent) 'qe-source'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'This installer requires Git for Windows.' }
if (-not (Test-Path -LiteralPath (Join-Path $qeSource '.git'))) {
    & git -c core.autocrlf=false clone --depth 1 --filter=blob:none --sparse --branch qe-7.5 https://github.com/QEF/q-e.git $qeSource
    if ($LASTEXITCODE -ne 0) { throw 'QE source download failed' }
}
if ((& git -C $qeSource rev-parse HEAD).Trim() -ne '770a0b2d12928a67048e2f3da8d10d057e52179e') { throw 'QE source revision mismatch' }
& git -C $qeSource -c core.autocrlf=false sparse-checkout set PW Modules upflib XClib UtilXlib FFTXlib LAXlib KS_Solvers install include external dft-d3
if ($LASTEXITCODE -ne 0) { throw 'QE source checkout failed' }
& git -C $qeSource submodule update --init --depth 1 external/fox external/devxlib external/mbd
if ($LASTEXITCODE -ne 0) { throw 'QE dependency download failed' }
& git -C $qeSource diff HEAD --exit-code
if ($LASTEXITCODE -ne 0) { throw 'QE source cache has local edits; installation stopped' }
$linuxSource = (& wsl -d VirtualFab-QE -u root --exec wslpath -a -u (Resolve-Path $qeSource).Path).Trim()
$linuxInstaller = (& wsl -d VirtualFab-QE -u root --exec wslpath -a -u (Join-Path $PSScriptRoot 'install-qe.sh')).Trim()
& wsl -d VirtualFab-QE -u root --exec bash $linuxInstaller $linuxSource
if ($LASTEXITCODE -ne 0) { throw 'QE build failed; see /opt/virtualfab/qe-{configure,build}.log in VirtualFab-QE' }
Write-Output 'VirtualFab-QE installed. Refresh the backend status in the atomic calculation view.'
