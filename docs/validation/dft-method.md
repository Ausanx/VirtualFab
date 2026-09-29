# DFT Stage 1 Method

This stage adds actual local first-principles calculations to the existing Electron application. It does not replace the process geometry engine or the DEVSIM silicon PN/PIN equilibrium solver. Atomic structures are explicit inputs, not inferred from micrometre process cards.

## Model And Workflow

ASE imports the first frame of CIF, POSCAR or extended XYZ, preserving the supplied cell and positions. A 2D import must have an XY slab and perpendicular Z cell; ASE centers the slab in Z, and VirtualFab checks conservative vacuum clearance before applying it. Unsupported elements, absent cells and invalid coordinates do not replace the current structure. Current coverage is 1-64 Si/Mo/S atoms with the pinned scalar-relativistic PBE ultrasoft pseudopotentials in `dft/pseudos.json`.

Each case uses a neutral, nonmagnetic, fixed-occupation model and fixed ions. A self-consistent calculation establishes the charge density; a separate uniform-grid NSCF calculation supplies the sampled band extrema. The baseline also uses an ASE high-symmetry path for an independent E(k) view. Empty bands are explicitly requested. SCF convergence, process exit, complete XML band data and closed-shell occupations must all be valid before accepting the result. ASE writes the input; the official QE 7.5 `pw.x` computes the electronic structure. The adapter is not a new DFT implementation. Input definitions follow the [official pw.x documentation](https://www.quantum-espresso.org/Doc/INPUT_PW.html).

For slabs, `assume_isolated='2D'` truncates the Coulomb interaction in Z. The validated cell height is at least `2 * atomic thickness + 10.6 A`, with conservative placement clearance. This implements the QE geometry guidance, not a proof of negligible electron-density tails; a separate vacuum increment tests sensitivity. See [Sohier, Calandra and Mauri, PRB 96, 075448 (2017)](https://doi.org/10.1103/PhysRevB.96.075448).

## Quantities And Acceptance

`sampledGapEv` is the nonnegative difference between the sampled conduction minimum and valence maximum. `signedGapEv` retains any overlap. QE XML declares Hartree atomic units; energies are converted to eV with ASE's Hartree constant. The band plot uses the sampled VBM as its zero. It has no vacuum reference. The finite uniform grid can miss extrema, and the high-symmetry path is not used as a substitute for a full-grid search.

Baseline settings are 60/480 Ry wavefunction/density cutoffs, a Gamma-centered density mesh of 6 and sampling mesh of 12 (Z is 1 for a slab), and `conv_thr=1e-8 Ry`. Separate cases increase cutoffs to 80/640 Ry, density mesh to 12, sampling mesh to 18, and 2D cell Z by 5 A. Energy differences are reported per atom, alongside gap differences; default thresholds are 5 meV/atom and 0.05 eV. The cutoffs change together at fixed density/wavefunction ratio, so this is not an independent `ecutrho` convergence test. A single increment passing a threshold is only a sensitivity check. Users must extend parameter studies for their own structure and accuracy target.

The Si prototype uses a fixed diamond primitive cell with a=5.43 A. The 1H MoS2 prototype uses a=3.18 A, S-S thickness=3.19 A and cell Z=23.19 A. These are explicitly unrelaxed test geometries. The indirect Si and direct monolayer MoS2 sampled characters and broad gap ranges are smoke checks. The qualitative monolayer MoS2 trend is consistent with [Kuc, Zibouche and Heine, PRB 83, 245213 (2011)](https://doi.org/10.1103/PhysRevB.83.245213); this is not a reproduction of that paper's parameters or a fitted quantitative residual.

The real benchmark independently reads every SCF total energy and NSCF sampled gap from QE's text output using ASE and compares them with the XML-derived quantities. This checks parsing and units in one calculation, not agreement between different DFT engines. Text bands are rounded to four decimal places; the gap tolerance is 0.0002 eV. The total-energy tolerance accounts for ASE readers' different CODATA constants. Results and every individual scan are recorded in [the generated report](dft-results.md).

## Provenance And Recovery

Jobs use immutable structure/setting snapshots and UUID folders in local application user data. They retain SHA256 hashes for input, the archived adapter, QE executable, linked libraries and pseudopotentials; observed ASE, NumPy, Python and platform versions are also recorded. Inputs, output logs, XML, band CSV and sensitivity CSV stay on disk. Completed result files and their declared evidence are checked before display. History shows the original input and distinguishes it from the currently applied model; transferred projects show absent local job data explicitly.

Cancellation and worker SIGTERM/SIGHUP stop the entire QE process group. Only complete, hashed scan checkpoints are reused. An incomplete scan is recomputed in a new attempt; earlier attempt logs remain. Retry is scan-level recovery, not resuming an interrupted SCF wavefunction. QE scratch data live temporarily in Linux storage and are removed after use, so the archived evidence cannot directly support a new post-processing calculation requiring wavefunctions. An app restart marks unfinished tasks interrupted and requests worker cancellation. Missing or malformed task status is also recovered this way; malformed contents are archived as `status.invalid-<UUID>.json`, and retries increment beyond the highest retained attempt directory rather than overwriting evidence.

The task model borrows the separation of input, process and output/provenance used by [AiiDA Quantum ESPRESSO](https://github.com/aiidateam/aiida-quantumespresso). It remains an adapter within VirtualFab's architecture; AiiDA, a database server and a remote job scheduler are not installed.

## Scientific Limits

PBE Kohn-Sham gaps are not measured optical gaps or many-body quasiparticle gaps. Their distinction has a theoretical basis in the exchange-correlation derivative discontinuity; see [Perdew and Levy, PRL 51, 1884 (1983)](https://doi.org/10.1103/PhysRevLett.51.1884). No empirical correction is applied and no DFT number automatically overwrites the material library.

This stage does not relax geometry, establish stability, model SOC or magnetism, run hybrid/GW/BSE calculations, align vacuum levels, construct atomic interfaces, or determine doping and defect populations. It does not predict whether process-created Te/InON regions form a working PN/PIN junction, nor produce interface band offsets, device E(x), I-V or optical response from these calculations. Those require separate models, specified interface structures and independent validation. The existing geometric candidates and silicon continuum solver keep their existing limits.
