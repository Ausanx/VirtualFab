# Solver Runtime

VirtualFab uses DEVSIM 2.11.0 without modifying the solver. Python model source is
in `solver/equilibrium.py`; the model follows DEVSIM's potential-only examples.

- DEVSIM: Apache-2.0. License is in `devsim-2.11.0.dist-info/licenses/LICENSE`;
  third-party notices are in `licenses/DEVSIM-NOTICE.txt`.
  Source: https://github.com/devsim/devsim/tree/v2.11.0.rc5
- OpenBLAS 0.3.31 LP64: BSD-3-Clause. `licenses/OpenBLAS-LICENSE.txt`.
  Unmodified official Windows DLL, release archive SHA256
  `e7595359700e8bb5a15c41af1920850b1be37078eb22813201b3d4bc5bd9227e`.
  Source: https://github.com/OpenMathLib/OpenBLAS/tree/v0.3.31
- UMFPACK 5.1 and AMD: LGPL-2.1-or-later, used by permission. Copyright
  Timothy A. Davis, Patrick R. Amestoy and Iain S. Duff; see DEVSIM notices
  and `licenses/UMFPACK-COPYING.txt` for component-specific notices.
  The unmodified DLL is dynamically loaded from
  `devsim/umfpack/umfpack_lgpl.dll` and may be replaced with a compatible build.
  Complete corresponding source and build files are in
  `licenses/UMFPACK-source.zip`, upstream commit
  `20ecaabd6d689a02e70c0debbb781301243dbe96` used by the DEVSIM build.
  Source: https://github.com/devsim/umfpack_lgpl/tree/20ecaabd6d689a02e70c0debbb781301243dbe96
- Python 3.13: PSF license, `licenses/Python-LICENSE.txt`.
- PyInstaller 6.22.3: GPL-2.0-or-later with bootloader exception. The exception
  permits distribution of frozen applications under their own licenses.
  `licenses/PyInstaller-COPYING.txt` includes the license and exception.
  Source and license: https://github.com/pyinstaller/pyinstaller/tree/v6.22.3

The runtime uses the bundled OpenBLAS DLL, not a machine-wide MKL installation.
Rebuild with the repository's `solver/requirements.txt` and `solver/build.ps1`.
DLLs and third-party files stay outside the application ASAR archive.
