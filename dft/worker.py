"""Local long-running QE worker. No remote services or credentials."""
import copy
import csv
import fcntl
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import time
import tempfile
import traceback
from pathlib import Path

from core import (PSEUDO_DIR, PSEUDOS, QE_EXECUTABLE, atomic_json, band_path, import_structure,
                  parse_xml, probe, qe_input, sha256)


class Canceled(Exception):
    pass


stop_signal = None


def request_stop(signum, frame):
    global stop_signal
    stop_signal = signum


def cancel_check(root):
    if stop_signal is not None or (root / 'cancel').exists():
        raise Canceled('Task canceled.')


def run_qe(root, folder, evidence, stage, settings, progress):
    cancel_check(root)
    output = evidence / (stage + '.out')
    shutil.copyfile(folder / (stage + '.in'), evidence / (stage + '.in'))
    atomic_json(root / 'progress.json', {**progress, 'stage': stage,
                'logRelative': output.relative_to(root).as_posix()})
    print(f"{progress['case']}: {stage}", flush=True)
    environment = {**os.environ, 'OMP_NUM_THREADS': str(settings['threads']),
                   'OPENBLAS_NUM_THREADS': '1', 'GFORTRAN_UNBUFFERED_ALL': 'Y'}
    with output.open('w') as log:
        child = subprocess.Popen([str(QE_EXECUTABLE), '-in', stage + '.in'], cwd=folder, stdin=subprocess.DEVNULL,
                                 stdout=log, stderr=subprocess.STDOUT, env=environment, start_new_session=True)
        started = time.monotonic()
        try:
            while child.poll() is None:
                cancel_check(root)
                if time.monotonic() - started > settings['maxSeconds'] + 20:
                    raise TimeoutError('QE stage exceeded the configured time limit.')
                time.sleep(0.25)
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            # A child may survive after the process-group leader exits.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            raise
    cancel_check(root)
    text = output.read_text(errors='replace')
    if child.returncode != 0 or 'JOB DONE.' not in text:
        raise ValueError(f'QE {stage} failed (exit {child.returncode}).\n' + text[-2500:])
    if stage != 'scf' and re.search(r'eigenvalues\s+not\s+converged', text, re.IGNORECASE):
        raise ValueError(f'QE {stage} reported unconverged eigenvalues; no band result accepted.')
    xml = folder / 'scratch' / 'vf.save' / 'data-file-schema.xml'
    parsed = parse_xml(xml, require_scf=stage == 'scf')
    shutil.copyfile(xml, evidence / (stage + '.xml'))
    return parsed


def cases_for(config):
    base = {'name': 'base', 'structure': config['structure'], 'settings': config['settings']}
    cutoff, density, sampling = (copy.deepcopy(base) for _ in range(3))
    cutoff['name'] = 'cutoff'
    cutoff['settings']['ecutwfcRy'] += config['settings']['cutoffStepRy']
    cutoff['settings']['ecutrhoRy'] *= cutoff['settings']['ecutwfcRy'] / config['settings']['ecutwfcRy']
    density['name'] = 'density'
    density['settings']['kDensity'] += config['settings']['kStep']
    sampling['name'] = 'sampling'
    sampling['settings']['kSampling'] += config['settings']['kStep']
    cases = [base, cutoff, density, sampling]
    if config['structure']['dimensionality'] == 2:
        vacuum = copy.deepcopy(base)
        vacuum['name'] = 'vacuum'
        step = config['settings']['vacuumStepAngstrom']
        vacuum['structure']['cellAngstrom'][2][2] += step
        for position in vacuum['structure']['positionsAngstrom']:
            position[2] += step / 2
        cases.append(vacuum)
    return cases


def cached_case(root, name):
    checkpoint = root / 'checkpoints' / (name + '.json')
    if not checkpoint.exists() or not checkpoint.with_suffix('.hash.json').exists():
        return None
    expected = json.loads(checkpoint.with_suffix('.hash.json').read_text())['sha256']
    if sha256(checkpoint) != expected:
        raise ValueError('Cached summary checksum mismatch; create a new task.')
    cached = json.loads(checkpoint.read_text())
    for relative, expected in cached['artifacts'].items():
        file = (root / relative).resolve()
        if not file.is_relative_to(root.resolve()) or not file.is_file() or sha256(file) != expected:
            raise ValueError('Cached evidence has changed; create a new task.')
    return cached


def execute(root, attempt, runtime):
    manifest = json.loads((root / 'manifest.json').read_text())
    if sha256(root / 'snapshot.json') != manifest['inputHash']:
        raise ValueError('Input snapshot checksum mismatch.')
    config = json.loads((root / 'snapshot.json').read_text())
    backend = probe()
    if any(backend[key] != manifest['backend'].get(key) for key in ['engineSha256', 'aseVersion', 'numpyVersion', 'runtimeHashes']):
        raise ValueError('Engine/ASE/numerical libraries changed since this task was created; create a new task.')
    pseudo_dir = root / 'pseudo'
    pseudo_dir.mkdir(exist_ok=True)
    for symbol in set(config['structure']['symbols']):
        info = PSEUDOS[symbol]
        target = pseudo_dir / info['file']
        if not target.exists():
            shutil.copyfile(PSEUDO_DIR / info['file'], target)
        if sha256(target) != info['sha256']:
            raise ValueError('Archived pseudopotential checksum mismatch.')
    runtime_pseudos = runtime / 'pseudo'
    shutil.copytree(pseudo_dir, runtime_pseudos)
    (root / 'checkpoints').mkdir(exist_ok=True)
    cases = cases_for(config)
    results = []
    for index, case in enumerate(cases):
        cancel_check(root)
        cached = cached_case(root, case['name'])
        if cached:
            results.append(cached)
            continue
        folder = runtime / 'attempts' / str(attempt) / case['name']
        evidence = root / 'attempts' / str(attempt) / case['name']
        folder.mkdir(parents=True)
        evidence.mkdir(parents=True)
        structure, settings = case['structure'], case['settings']
        progress = {'case': case['name'], 'completedCases': index, 'totalCases': len(cases), 'attempt': attempt}
        def mesh(n):
            return (n, n, 1 if structure['dimensionality'] == 2 else n)
        qe_input(folder / 'scf.in', structure, settings, runtime_pseudos, 'scf', mesh(settings['kDensity']))
        scf = run_qe(root, folder, evidence, 'scf', settings, progress)
        qe_input(folder / 'nscf.in', structure, settings, runtime_pseudos, 'nscf', mesh(settings['kSampling']))
        sampled = run_qe(root, folder, evidence, 'nscf', settings, progress)
        summary = {key: sampled[key] for key in ['sampledGapEv', 'signedGapEv', 'gapKind', 'vbmEv', 'cbmEv',
                   'vbmIndex', 'cbmIndex', 'kpointCount', 'electronCount', 'occupiedBands', 'bandCount']}
        summary.update(name=case['name'], scfConverged=scf['scfConverged'], totalEnergyEv=scf['totalEnergyEv'],
                       settings=settings, cellZAngstrom=structure['cellAngstrom'][2][2],
                       vbmKpoint=sampled['kpointsCartesian2PiAlat'][sampled['vbmIndex']],
                       cbmKpoint=sampled['kpointsCartesian2PiAlat'][sampled['cbmIndex']])
        if case['name'] == 'base':
            try:
                path, path_data = band_path(structure)
            except ValueError:
                summary['pathWarning'] = 'ASE could not identify a reciprocal-space path for this cell.'
            else:
                qe_input(folder / 'bands.in', structure, settings, runtime_pseudos, 'bands', path)
                bands = run_qe(root, folder, evidence, 'bands', settings, progress)
                if len(path_data['x']) != len(bands['eigenvaluesEv']):
                    raise ValueError('QE band count does not match the ASE path.')
                summary['bands'] = {**path_data, 'energiesEv': bands['eigenvaluesEv'], 'referenceEv': sampled['vbmEv']}
                with (evidence / 'bands.csv').open('w', newline='') as stream:
                    writer = csv.writer(stream)
                    writer.writerow(['path_inv_A', 'kx_fractional', 'ky_fractional', 'kz_fractional', 'band_1based', 'energy_eV', 'energy_minus_sampled_VBM_eV'])
                    for x, k, energies in zip(path_data['x'], path_data['fractionalKpoints'], bands['eigenvaluesEv']):
                        for band, energy in enumerate(energies):
                            writer.writerow([x, *k, band + 1, energy, energy - sampled['vbmEv']])
        summary['artifacts'] = {file.relative_to(root).as_posix(): sha256(file)
                                for file in evidence.iterdir() if file.suffix in ['.in', '.out', '.xml', '.csv']}
        atomic_json(root / 'checkpoints' / (case['name'] + '.json'), summary)
        atomic_json(root / 'checkpoints' / (case['name'] + '.hash.json'),
                    {'sha256': sha256(root / 'checkpoints' / (case['name'] + '.json'))})
        results.append(summary)
        shutil.rmtree(folder)
    cancel_check(root)
    base = results[0]
    checks = []
    for row in results[1:]:
        energy_difference = abs(row['totalEnergyEv'] - base['totalEnergyEv']) * 1000 / len(config['structure']['symbols'])
        gap_difference = abs(row['sampledGapEv'] - base['sampledGapEv'])
        checks.append({'name': row['name'], 'energyDifferenceMevAtom': energy_difference, 'gapDifferenceEv': gap_difference,
                       'withinTolerance': energy_difference <= config['settings']['energyToleranceMevAtom'] and gap_difference <= config['settings']['gapToleranceEv']})
    result = {'schemaVersion': 1, 'inputHash': manifest['inputHash'], 'config': config, 'backend': backend,
              'baseline': base, 'cases': results, 'sensitivity': {'checks': checks, 'allWithinTolerance': all(c['withinTolerance'] for c in checks)},
              'limitations': ['Fixed geometry; no structural relaxation or stability test.', 'PBE scalar-relativistic, neutral, nonmagnetic, fixed occupations; no SOC.',
                              'Uniform-grid sampled Kohn-Sham gap; finite-grid extrema may miss the fundamental gap.',
                              'One-increment parameter sensitivity is not a proof of asymptotic convergence or experimental accuracy.',
                              'Band energies have an internal reference, not vacuum alignment, optical or quasiparticle energies.',
                              'No interface, doping, defect, device electrostatics or transport mapping.']}
    with (root / 'sensitivity.csv').open('w', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['case', 'ecutwfc_Ry', 'ecutrho_Ry', 'k_density', 'k_sampling', 'cell_z_A', 'total_energy_eV', 'sampled_KS_gap_eV'])
        for row in results:
            settings = row['settings']
            writer.writerow([row['name'], settings['ecutwfcRy'], settings['ecutrhoRy'], settings['kDensity'], settings['kSampling'], row['cellZAngstrom'], row['totalEnergyEv'], row['sampledGapEv']])
    atomic_json(root / 'result.json', result)
    atomic_json(root / 'progress.json', {'stage': 'done', 'completedCases': len(cases), 'totalCases': len(cases), 'attempt': attempt})


def main():
    global stop_signal
    command = sys.argv[1]
    if command == 'probe':
        return probe()
    if command == 'import':
        return import_structure(Path(sys.argv[2]), int(sys.argv[3]))
    if command == 'run':
        stop_signal = None
        for signum in [signal.SIGTERM, signal.SIGHUP]:
            signal.signal(signum, request_stop)
    root = Path(sys.argv[2])
    with (root / 'worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Previous worker is still stopping. Refresh and retry.')
        if command == 'idle':
            return {'idle': True}
        if command != 'run':
            raise ValueError('Unknown worker operation.')
        # Keep scratch data on Linux storage and QE input paths short and ASCII.
        with tempfile.TemporaryDirectory(prefix='vf-', dir='/tmp') as folder:
            execute(root, int(sys.argv[3]), Path(folder))
    return {'completed': True}


if __name__ == '__main__':
    try:
        value = main()
        print('VIRTUALFAB_DFT:' + json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)
    except Exception as error:
        traceback.print_exc()
        print('VIRTUALFAB_DFT:' + json.dumps({'error': str(error)}, ensure_ascii=True), flush=True)
        sys.exit(2)
