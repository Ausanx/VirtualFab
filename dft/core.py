"""ASE input adapter and conservative Quantum ESPRESSO XML extraction."""
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import platform
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import ase
import numpy as np
from ase import Atoms
from ase.io import read
from ase.io.espresso import write_espresso_in
from ase.units import Hartree

PSEUDOS = json.loads((Path(__file__).parent / 'pseudos.json').read_text())
PSEUDO_DIR = Path('/opt/virtualfab/pseudo')
QE_EXECUTABLE = Path('/opt/virtualfab/qe/bin/pw.x')


def sha256(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_json(file, value):
    file = Path(file)
    temporary = file.with_suffix(file.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=True, allow_nan=False), encoding='utf8')
    temporary.replace(file)


def atoms_from(structure):
    return Atoms(symbols=structure['symbols'], positions=structure['positionsAngstrom'],
                 cell=structure['cellAngstrom'], pbc=[True, True, structure['dimensionality'] == 3])


def import_structure(file, dimensionality):
    file = Path(file)
    if file.stat().st_size > 2_000_000:
        raise ValueError('Structure exceeds 2 MB.')
    suffix = file.suffix.lower()
    formats = {'.cif': 'cif', '.vasp': 'vasp', '.poscar': 'vasp', '.xyz': 'extxyz', '.extxyz': 'extxyz'}
    format_name = 'vasp' if file.name.upper() == 'POSCAR' else formats.get(suffix)
    if format_name is None:
        raise ValueError('Supported formats: CIF, POSCAR, extended XYZ.')
    atoms = read(file, format=format_name, index=0)
    if not 1 <= len(atoms) <= 64 or abs(atoms.cell.volume) < 1:
        raise ValueError('Import requires 1-64 atoms and a nonsingular periodic cell.')
    if any(symbol not in PSEUDOS for symbol in atoms.get_chemical_symbols()):
        raise ValueError('First-stage pseudopotentials support Si/Mo/S only.')
    if not np.isfinite(atoms.positions).all() or not np.isfinite(atoms.cell.array).all():
        raise ValueError('Nonfinite atomic coordinates.')
    if dimensionality == 2:
        if not np.allclose(atoms.cell.array[:2, 2], 0) or not np.allclose(atoms.cell.array[2, :2], 0):
            raise ValueError('2D imports require an XY slab and perpendicular Z cell.')
        atoms.center(axis=2)
    return {'name': file.name[:120], 'dimensionality': dimensionality,
            'symbols': atoms.get_chemical_symbols(), 'positionsAngstrom': atoms.positions.tolist(),
            'cellAngstrom': atoms.cell.array.tolist(),
            'source': f'ASE {ase.__version__} import: {file.name[:120]}; original SHA256 {sha256(file)}; first frame; ' +
                      ('slab centered in Z.' if dimensionality == 2 else 'coordinates retained.')}


def probe():
    executable = QE_EXECUTABLE
    if not executable.is_file():
        raise ValueError('Quantum ESPRESSO 7.5 is missing. Run dft/setup.ps1.')
    with tempfile.TemporaryDirectory(prefix='virtualfab-probe-') as folder:
        output = subprocess.run([executable, '-h'], input='', capture_output=True, text=True, cwd=folder, timeout=20)
    versions = re.findall(r'Program PWSCF\s+(v\S+)', output.stdout)
    if not versions or versions[0] != 'v.7.5':
        raise ValueError('First stage requires the verified Quantum ESPRESSO 7.5 build.')
    pseudos = []
    for symbol, info in PSEUDOS.items():
        file = PSEUDO_DIR / info['file']
        if not file.is_file() or sha256(file) != info['sha256']:
            raise ValueError(f'Missing or mismatched pseudopotential: {symbol}. Run dft/setup.ps1.')
        header = ET.parse(file).getroot().find('PP_HEADER')
        if header is None or header.attrib['functional'].strip() != 'PBE' or header.attrib['element'].strip() != symbol:
            raise ValueError(f'Invalid PBE pseudopotential: {symbol}.')
        pseudos.append({'element': symbol, **info, 'valence': float(header.attrib['z_valence']),
                        'wfcCutoffRy': float(header.attrib['wfc_cutoff']),
                        'rhoCutoffRy': float(header.attrib['rho_cutoff'])})
    linked = subprocess.run(['ldd', executable], capture_output=True, text=True, check=True, timeout=20)
    libraries = re.findall(r'(?:=>\s+|^\s*)(/\S+)\s+\(', linked.stdout, re.MULTILINE)
    runtime_hashes = {str(Path(file).resolve()): sha256(file) for file in libraries}
    return {'ready': True, 'engine': 'Quantum ESPRESSO ' + versions[0], 'engineSha256': sha256(executable),
            'aseVersion': ase.__version__, 'numpyVersion': np.__version__, 'pythonVersion': sys.version.split()[0],
            'platform': platform.platform(), 'runtimeHashes': runtime_hashes,
            'buildInfo': (executable.parent.parent / 'build-info.txt').read_text().strip(), 'pseudos': pseudos}


def qe_input(file, structure, settings, pseudo_dir, calculation, kpts):
    atoms = atoms_from(structure)
    valence = sum(float(ET.parse(Path(pseudo_dir) / PSEUDOS[s]['file']).getroot().find('PP_HEADER').attrib['z_valence'])
                  for s in structure['symbols'])
    if not valence.is_integer() or int(valence) % 2:
        raise ValueError('Fixed-occupation neutral nonmagnetic model requires an even electron count.')
    system = {'ibrav': 0, 'ecutwfc': settings['ecutwfcRy'], 'ecutrho': settings['ecutrhoRy'],
              'input_dft': 'PBE', 'occupations': 'fixed', 'nbnd': int(valence / 2) + 8}
    if structure['dimensionality'] == 2:
        system['assume_isolated'] = '2D'
    if calculation == 'bands':
        system.update(nosym=True, noinv=True)
    parameters = {
        'control': {'calculation': calculation, 'prefix': 'vf', 'pseudo_dir': os.path.relpath(pseudo_dir, Path(file).parent),
                    'outdir': './scratch', 'verbosity': 'high', 'disk_io': 'low', 'tprnfor': True,
                    'max_seconds': settings['maxSeconds']},
        'system': system,
        'electrons': {'conv_thr': settings['convThrRy'], 'mixing_beta': 0.3, 'electron_maxstep': 150,
                      'diago_full_acc': True, 'diago_thr_init': 1e-10 if calculation != 'scf' else 1e-6},
    }
    with Path(file).open('w', encoding='ascii', newline='\n') as stream:
        write_espresso_in(stream, atoms, input_data=parameters,
                          pseudopotentials={s: PSEUDOS[s]['file'] for s in set(structure['symbols'])},
                          kpts=kpts, koffset=(0, 0, 0))


def band_path(structure):
    atoms = atoms_from(structure)
    path = atoms.cell.bandpath(npoints=61, pbc=atoms.pbc)
    x, ticks, labels = path.get_linear_kpoint_axis()
    return path, {'x': x.tolist(), 'ticks': ticks.tolist(), 'labels': labels,
                  'fractionalKpoints': path.kpts.tolist(), 'path': path.path}


def parse_xml(file, require_scf=False):
    if Path(file).stat().st_size > 100_000_000:
        raise ValueError('QE XML exceeds 100 MB.')
    root = ET.parse(file).getroot()
    if root.attrib.get('Units') != 'Hartree atomic units':
        raise ValueError('Unknown QE XML units; expected Hartree atomic units.')
    for node in root.iter():
        node.tag = node.tag.split('}')[-1]
    output = root.find('output')
    if output is None:
        raise ValueError('Missing QE output section.')
    converged = output.findtext('convergence_info/scf_conv/convergence_achieved')
    if require_scf and (converged or '').strip().lower() != 'true':
        raise ValueError('QE SCF did not converge.')
    bands = output.find('band_structure')
    if bands is None or any(bands.findtext(key, 'false').strip().lower() == 'true' for key in ['lsda', 'spinorbit', 'noncolin']):
        raise ValueError('Missing bands or unsupported spin model.')
    if bands.findtext('occupations_kind', '').strip() != 'fixed':
        raise ValueError('Only fixed occupations are supported.')
    nelec = float(bands.findtext('nelec', 'nan'))
    nbnd = int(bands.findtext('nbnd', '0'))
    if not math.isfinite(nelec) or nelec < 2 or abs(nelec - round(nelec)) > 1e-8 or round(nelec) % 2:
        raise ValueError('Unsupported fractional or odd electron count.')
    occupied = round(nelec) // 2
    if nbnd <= occupied:
        raise ValueError('No empty bands; cannot determine a sampled gap.')
    energies, kpoints = [], []
    for point in bands.findall('ks_energies'):
        values = [float(v) * Hartree for v in point.findtext('eigenvalues', '').split()]
        occupations = [float(v) for v in point.findtext('occupations', '').split()]
        k = [float(v) for v in point.findtext('k_point', '').split()]
        if len(values) != nbnd or len(k) != 3 or not all(math.isfinite(v) for v in values + k):
            raise ValueError('Incomplete or nonfinite QE band data.')
        if len(occupations) != nbnd or any(not math.isfinite(v) or abs(v - (1 if i < occupied else 0)) > 1e-8 for i, v in enumerate(occupations)):
            raise ValueError('QE occupations do not match the supported closed-shell model.')
        energies.append(values)
        kpoints.append(k)
    if not energies or len(energies) != int(bands.findtext('nks', '0')):
        raise ValueError('QE k-point count is missing or incomplete.')
    vbm_index = max(range(len(energies)), key=lambda i: energies[i][occupied - 1])
    cbm_index = min(range(len(energies)), key=lambda i: energies[i][occupied])
    vbm, cbm = energies[vbm_index][occupied - 1], energies[cbm_index][occupied]
    etot = output.findtext('total_energy/etot')
    total = float(etot) * Hartree if etot is not None else None
    if total is not None and not math.isfinite(total):
        raise ValueError('Nonfinite total energy.')
    if require_scf and total is None:
        raise ValueError('Missing SCF total energy.')
    return {'totalEnergyEv': total, 'sampledGapEv': max(0, cbm - vbm), 'signedGapEv': cbm - vbm,
            'gapKind': 'kohn-sham-sampled', 'vbmEv': vbm, 'cbmEv': cbm, 'vbmIndex': vbm_index,
            'cbmIndex': cbm_index, 'kpointsCartesian2PiAlat': kpoints, 'eigenvaluesEv': energies,
            'electronCount': nelec, 'occupiedBands': occupied, 'kpointCount': len(energies), 'bandCount': nbnd,
            'scfConverged': (converged or '').strip().lower() == 'true'}
