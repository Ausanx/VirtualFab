<div align="center">

# VirtualFab Studio

**A local workbench for thin-film processes and semiconductor device geometry.**

Build process recipes, inspect 3D structures, and run traceable silicon equilibrium calculations.

[![Checks](https://github.com/Ausanx/VirtualFab/actions/workflows/checks.yml/badge.svg)](https://github.com/Ausanx/VirtualFab/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2F7FAE.svg)](LICENSE)
[![Desktop: Windows x64](https://img.shields.io/badge/Desktop-Windows_x64-4F565D.svg)](#quick-start)
[![Status: Prototype](https://img.shields.io/badge/Status-Prototype-E5A15A.svg)](#model-scope)

**English** · [简体中文](README.zh-CN.md)

[Quick start](#quick-start) · [Features](#features) · [Validation](#validation) · [Roadmap](#roadmap)

</div>

![VirtualFab process workbench showing a thin-film crossbar, cross-section and process cards](docs/images/workbench.png)

VirtualFab connects a process recipe to the geometry it produces: photoresist, exposure, development, deposition, etching and lift-off remain visible as individual steps. Inspect the resulting layers and contacts, track the evidence behind material parameters, and map supported silicon structures to a one-dimensional equilibrium model.

The desktop app runs locally with Electron. Project files are JSON; calculations use local backends. A separate atomic workspace runs Quantum ESPRESSO calculations for Si and monolayer MoS₂. **The current release is an engineering prototype.** Its numerical checks and model limits are documented below.

## Features

| Workflow | What you can do |
| --- | --- |
| Process recipes | Start from crossbar, bottom-gate, top-gate, heterojunction or blank templates. Add, edit, reorder, disable and replay process steps. |
| Geometry inspection | Inspect a 3D local structure, layer separation, wafer/die overview and movable cross-section. Compare lateral sampling resolutions. |
| Materials and interfaces | Edit 25 initial material entries, parameter sources and conditions. Inspect contact topology, PN/PIN candidates, gates and evidence-based band offsets. |
| Silicon equilibrium | Map supported rectangular Si regions and given dopants to a 1D PN/PIN model. View potential, bands, carriers, electric field and depletion-threshold sensitivity. |
| Atomic calculations | Import CIF, POSCAR or extended XYZ. Run local QE SCF, uniform-grid NSCF and band paths, with parameter-sensitivity checks and raw evidence. |
| Project history | Save/open JSON projects, cancel background jobs, inspect historical inputs and export CSV with metadata or result JSON. |

| Silicon PN equilibrium | Atomic workspace |
| --- | --- |
| ![Silicon PN equilibrium computed from a mapped process structure](docs/images/silicon-equilibrium.png) | ![Real Si Kohn-Sham bands and parameter checks in the atomic workspace](docs/images/atomic-workspace.png) |

*The current application interface is in Chinese. The screenshots show built-in examples.*

## Quick start

### Run the process editor

Install [Node.js 22.12 or newer](https://nodejs.org/) and Git, then run:

```sh
git clone https://github.com/Ausanx/VirtualFab.git
cd VirtualFab
npm ci
npm start
```

Open **[127.0.0.1:4173](http://127.0.0.1:4173)**. The browser entry supports process editing and geometry inspection. The calculation backends are available through the desktop app.

On Windows, launch the desktop app from the same checkout:

```sh
npm run desktop
```

Choose a template, replay the process cards, inspect the cross-section, then save the project as JSON. Installation downloads dependencies; normal editing does not require an Internet connection.

### Enable silicon equilibrium on Windows

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then build the local solver:

```powershell
uv venv --python 3.13 .venv-solver
uv pip install --python .venv-solver\Scripts\python.exe -r solver/requirements.txt
npm run build:solver
npm run desktop
```

In **能带与界面 → PN/PIN 平衡 → 当前工艺结构**, create a silicon PN or PIN benchmark, review the regions and path, then calculate. The solver uses DEVSIM 2.11.0 with bundled Python and OpenBLAS.

### Optional: enable atomic calculations

Install WSL2 and Git for Windows, then run:

```powershell
npm run setup:dft
```

The installer creates an isolated `VirtualFab-QE` WSL2 environment, downloads verified inputs and compiles QE 7.5. Initial setup needs Internet access, disk space and build time. Later calculations run locally. See the [setup guide](docs/guide.zh-CN.md#本地-dft-后端) and [DFT method](docs/validation/dft-method.md).

### Build a Windows portable app

After installing the solver build dependencies above:

```powershell
npm run package:win
```

Open `dist/VirtualFab-win32-x64/VirtualFab.exe` and keep that whole directory together. The package includes the silicon solver; QE and Linux are installed separately. See the [full usage and build guide](docs/guide.zh-CN.md).

## Model scope

| Area | Current scope and limits |
| --- | --- |
| Process geometry | Sampled XY columns with continuous Z intervals. Deposition is a top-surface approximation. No 3D process kinetics, sidewall flux or experimental process calibration. |
| Material data | Sources and conditions are explicit. Many initial values are estimates; InON band parameters remain missing. Missing values are not treated as zero. |
| Device physics | 300 K, zero-bias, bulk-Si homojunction PN/PIN; given uncompensated dopants, complete ionization, Boltzmann statistics and ideal neutral ohmic ends. Geometry mapping requires a uniform rectangular cross-section. |
| DFT | Fixed-geometry PBE, nonmagnetic, neutral, scalar-relativistic calculations, initially tested on Si/MoS₂. Outputs are sampled Kohn–Sham bands/gaps. DFT is independent of process geometry and device transport. |
| Validation | Numerical convergence, boundary applicability, literature comparison and experimental calibration are separate. A solver finishing successfully does not establish device accuracy. |

The Shockley I–V view uses manually supplied model parameters. Predictive transport, gate characteristics, memory effects and photocarrier dynamics are future work.

**Project JSON stores job references, not calculation files.** Raw results stay in local `physics-jobs/<UUID>` and `dft-jobs/<UUID>` directories. Copying the JSON alone does not transfer job evidence. Changed inputs make previous results historical; unconverged or damaged results do not appear as valid curves.

## Validation

Run the portable core checks:

```sh
npm test
npm run check
```

GitHub Actions runs these checks on Windows and Linux. Desktop interaction and physical calculations have additional local checks:

```powershell
npm run test:browser
npm run test:desktop
npm run validate:physics
npm run validate:device
npm run test:device:desktop
```

The physics commands need a built solver. DFT checks need the installed QE backend. Full commands, results and assumptions:

- [Release review and verification](docs/validation/release-review.md)
- [Silicon equilibrium benchmarks](docs/validation/equilibrium-results.md) · [Process-to-device mapping](docs/validation/device-equilibrium.md)
- [Literature comparison](docs/validation/literature-calibration.md) · [Comparison results](docs/validation/literature-results.md)
- [DFT method](docs/validation/dft-method.md) · [Real QE results](docs/validation/dft-results.md)

`npm run validate:literature:strict` currently fails the default MoS₂/WSe₂ band-offset comparison. This is a documented calibration gap. The Si charge-density grid and MoS₂ cutoff also need further refinement; see the DFT report.

## Roadmap

- [x] Process editing, geometry inspection and material evidence.
- [x] Region-level dopants and process-to-silicon equilibrium mapping (A–B).
- [x] Local atomic calculations with input/result provenance.
- [ ] Independent numerical comparison and complete public benchmarks (C).
- [ ] Portable calculation-evidence bundles (D).
- [ ] Validated dark silicon J–V (E).
- [ ] Condition-matched MoS₂/WSe₂ extension (F).

The [agreed physics roadmap](docs/plans/2026-10-07-physics-closure-design.md) defines the acceptance criteria for each stage.

## Contributing

[Open an issue](https://github.com/Ausanx/VirtualFab/issues) with reproduction steps, application/runtime versions and the expected result. A small example project is helpful when you are comfortable sharing it. Keep fixes focused and run the relevant checks. For physical models, include units, assumptions, parameter sources and a verifiable benchmark.

## License and acknowledgements

VirtualFab's own source is licensed under [MIT](LICENSE). It uses [Electron](https://github.com/electron/electron), [Three.js](https://github.com/mrdoob/three.js), [Split Grid](https://github.com/nathancahill/split), [DEVSIM](https://github.com/devsim/devsim) and an adapter for [Quantum ESPRESSO](https://www.quantum-espresso.org/). Third-party terms are documented in the [solver notices](solver/THIRD-PARTY.md) and [DFT notices](dft/THIRD-PARTY.md).
