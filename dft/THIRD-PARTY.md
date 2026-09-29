# DFT Backend Dependencies

The Windows application contains VirtualFab's adapter and installer. Quantum ESPRESSO and the Linux runtime are installed separately in the dedicated `VirtualFab-QE` WSL2 distribution. No QE binary or UPF data is embedded in the portable Windows application.

| Dependency | Source / version used | License / record |
|---|---|---|
| Quantum ESPRESSO | [QEF/q-e](https://github.com/QEF/q-e), qe-7.5, commit `770a0b2d12928a67048e2f3da8d10d057e52179e` | GPL v2; upstream `License` retained in `/opt/virtualfab/qe-source` and `/opt/virtualfab/qe/License` |
| FoX | QE submodule, commit `3453648e6837658b747b895bb7bef4b1ed2eac40` | BSD-style license and individual source notices retained in `external/fox` |
| devXlib | QE submodule, commit `a6b89ef77b1ceda48e967921f1f5488d2df9226d` | Upstream source notices retained in `external/devxlib` |
| libMBD | QE submodule, commit `89a3cc199c0a200c9f0f688c3229ef6b9a8d63bd` | MPL 2.0; `external/mbd/LICENSE` retained |
| ASE | Ubuntu 24.04 `python3-ase`, observed version 3.22.1 | LGPL 2.1 or later; `/usr/share/doc/python3-ase/copyright` |
| NumPy / Python | Ubuntu 24.04 packages, observed versions 1.26.4 / 3.12.3 | Package copyright notices in `/usr/share/doc`; exact observed versions stored in each job |
| OpenBLAS / FFTW | Ubuntu 24.04 packages, observed versions 0.3.26 / 3.3.10 | BSD 3-clause / GPL 2 or later; `/usr/share/doc/libopenblas-dev/copyright`, `/usr/share/doc/libfftw3-dev/copyright` |
| PSLibrary UPF files | [QE pseudopotential repository](https://pseudopotentials.quantum-espresso.org/), Si/Mo/S PBE scalar-relativistic USPP 1.0.0 | Files downloaded by installer, their original `PP_INFO` retained; URLs and SHA256 in `pseudos.json` |

The installer retains the checked-out QE source and dependency licenses under `/opt/virtualfab/qe-source`; it builds `pw.x` with gfortran, OpenMP and Ubuntu BLAS/LAPACK/FFTW, without MPI. Shell script line endings are normalized for Linux. `build-info.txt` records the source revision. Numerical library and executable hashes are recorded in every job and checked before a retry.

Ubuntu Base 24.04.5 is downloaded from Canonical with a pinned SHA256. Apt uses signed Ubuntu package metadata. Package revisions can change with Ubuntu updates; a job does not silently continue with a different executable, ASE, NumPy or linked numerical library. Installer network access downloads public dependencies only. Structure import, calculation, result parsing and project files remain local.

QE citations and scientific limitations are given in [DFT method](../docs/validation/dft-method.md). Redistribution of the installed Linux environment requires retaining its component notices and satisfying the corresponding source obligations; the Windows portable package does not redistribute that environment.
