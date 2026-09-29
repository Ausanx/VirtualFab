# Real QE DFT Validation

Run: 2026-09-29T16:27:38.128Z. Engine: Quantum ESPRESSO v.7.5; ASE 3.22.1. All values below came from real local QE processes.

| Structure | Total energy (eV/cell) | Uniform-grid sampled KS gap (eV) | Cases | Sensitivity | Job ID |
|---|---:|---:|---:|---|---|
| Si | -310.727792 | 0.570411 | 4 | requires refinement | 6338285c-66e5-4a1b-b34a-012b50379188 |
| MoS2 | -2470.499829 | 1.739088 | 5 | requires refinement | 8276a3f1-981d-4c34-81b2-98adb1d4e043 |

| Structure | Scan | Energy difference (meV/atom) | Sampled gap difference (eV) | Current tolerance |
|---|---|---:|---:|---|
| Si | cutoff | 0.141859 | 0.000011 | pass |
| Si | density | 11.910403 | 0.003269 | refine |
| Si | sampling | 0.000000 | 0.011641 | pass |
| MoS2 | cutoff | 5.833999 | 0.000258 | refine |
| MoS2 | density | 0.361432 | 0.001370 | pass |
| MoS2 | sampling | 0.000000 | 0.000000 | pass |
| MoS2 | vacuum | 0.014842 | 0.000022 | pass |

Baseline: fixed unrelaxed Si a=5.43 A; 1H MoS2 a=3.18 A, S-S thickness=3.19 A, cell Z=23.19 A. PBE scalar-relativistic USPP, no SOC, neutral/nonmagnetic, 60/480 Ry, density mesh 6, sampling mesh 12; offsets zero, conv_thr=1e-8 Ry. Separate scans: 80/640 Ry, density mesh 12, sampling mesh 18, and MoS2 cell Z +5 A with the slab recentered.

These are numerical smoke and one-increment sensitivity tests. Broad gap ranges (Si 0.3-0.9 eV, MoS2 1.3-2.3 eV) and sampled indirect/direct character are sanity gates, not fitted literature residuals or independent-code cross-validation. Even passing sensitivity is not proof of asymptotic convergence, physical stability or experiment agreement. The sampled gap can miss extrema between grid points; path energies are plotted separately. No vacuum reference, optical/quasiparticle gap, interface offset or device transport is derived.

Raw evidence: artifacts/dft-benchmarks/<job-id>/{manifest.json,snapshot.json,pseudo,adapter,attempts,checkpoints,result.json,sensitivity.csv}. Per-case QE inputs, logs, XML and band CSV are hashed. GUI regression and packaged-app checks are recorded separately.

## Independent Parser Checks

QE XML energy and sampled gap were compared with ASE's espresso-out parser for every case. This checks extraction and unit conversion from the same QE calculation; it is not an independent electronic-structure engine. The energy tolerance includes the different CODATA constants used by ASE's two readers; gap agreement must be within 0.0002 eV (the text output is rounded).

| Structure | Case | Energy difference (eV/cell) | Gap difference (eV) | Check |
|---|---|---:|---:|---|
| Si | base | 2.460e-5 | 1.095e-5 | pass |
| Si | cutoff | 2.464e-5 | 1.603e-7 | pass |
| Si | density | 2.470e-5 | 2.005e-5 | pass |
| Si | sampling | 2.460e-5 | 4.814e-5 | pass |
| MoS2 | base | 1.960e-4 | 1.229e-5 | pass |
| MoS2 | cutoff | 1.960e-4 | 2.985e-5 | pass |
| MoS2 | density | 1.960e-4 | 5.780e-5 | pass |
| MoS2 | sampling | 1.960e-4 | 1.229e-5 | pass |
| MoS2 | vacuum | 1.960e-4 | 3.407e-5 | pass |

Method and primary references: [DFT method](dft-method.md).
