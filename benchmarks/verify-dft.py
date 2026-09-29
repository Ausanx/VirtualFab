"""Compare archived QE XML quantities with ASE's independent text-output parser."""
import json
import sys
from pathlib import Path

import numpy as np
from ase.io import read

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dft'))
from core import parse_xml

root = Path(sys.argv[1])
result = json.loads((root / 'result.json').read_text())
checks = []
for case in result['cases']:
    log = next(file for file in case['artifacts'] if file.endswith('/scf.out'))
    folder = (root / log).parent
    xml = parse_xml(folder / 'scf.xml', require_scf=True)
    text_energy = read(folder / 'scf.out', format='espresso-out').get_potential_energy()
    energy_delta = abs(text_energy - xml['totalEnergyEv'])
    # ASE's QE text reader uses CODATA 2006; ase.units.Hartree uses CODATA 2014.
    energy_tolerance = max(0.0001 * len(result['config']['structure']['symbols']), abs(text_energy) * 2e-7)
    assert energy_delta <= energy_tolerance, f"{case['name']}: text/XML total energy mismatch"
    text_bands = read(folder / 'nscf.out', format='espresso-out')
    points = text_bands.calc.get_ibz_k_points()
    values = np.array([text_bands.calc.get_eigenvalues(kpt=i) for i in range(len(points))])
    occupied = case['occupiedBands']
    gap = max(0.0, values[:, occupied].min() - values[:, occupied - 1].max())
    gap_delta = abs(float(gap) - case['sampledGapEv'])
    assert gap_delta <= 0.0002, f"{case['name']}: text/XML sampled gap mismatch"
    checks.append({'case': case['name'], 'textEnergyEv': float(text_energy),
                   'energyDeltaEv': energy_delta, 'energyToleranceEv': energy_tolerance,
                   'textSampledGapEv': float(gap), 'gapDeltaEv': gap_delta, 'gapToleranceEv': 0.0002})
print(json.dumps(checks, allow_nan=False))
