import tempfile
import unittest
from pathlib import Path
import sys
import multiprocessing
import os
import signal
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dft'))
from core import parse_xml, import_structure
from core import atomic_json, sha256
from worker import cached_case
import worker

XML = '''<qes:espresso xmlns:qes="urn:test" Units="Hartree atomic units"><general_info><creator VERSION="test"/></general_info><output>
<convergence_info><scf_conv><convergence_achieved>true</convergence_achieved></scf_conv></convergence_info>
<total_energy><etot>-4</etot></total_energy><band_structure><nelec>2</nelec><nbnd>2</nbnd><nks>2</nks><occupations_kind>fixed</occupations_kind>
<ks_energies><k_point>0 0 0</k_point><eigenvalues>-0.2 0.1</eigenvalues><occupations>1 0</occupations></ks_energies>
<ks_energies><k_point>0.5 0 0</k_point><eigenvalues>-0.1 0.2</eigenvalues><occupations>1 0</occupations></ks_energies>
</band_structure></output></qes:espresso>'''


class CoreTest(unittest.TestCase):
    def read_xml(self, text):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'data.xml'
            file.write_text(text)
            return parse_xml(file, require_scf=True)

    def test_units_and_global_extrema(self):
        result = self.read_xml(XML)
        self.assertAlmostEqual(result['totalEnergyEv'], -108.845544, places=4)
        self.assertAlmostEqual(result['sampledGapEv'], 5.442277, places=4)
        self.assertEqual(result['vbmIndex'], 1)
        self.assertEqual(result['cbmIndex'], 0)
        self.assertEqual(result['gapKind'], 'kohn-sham-sampled')

    def test_failed_and_incomplete_calculations_are_not_results(self):
        for text in [XML.replace('true', 'false'), XML.replace('<nelec>2', '<nelec>3'),
                     XML.replace('<nbnd>2', '<nbnd>1'), XML.replace('-0.2 0.1', 'nan 0.1')]:
            with self.assertRaises(ValueError):
                self.read_xml(text)

    def test_ase_import_and_cell_requirement(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'structure.xyz'
            file.write_text('2\nLattice="0 2.715 2.715 2.715 0 2.715 2.715 2.715 0" Properties=species:S:1:pos:R:3 pbc="T T T"\nSi 0 0 0\nSi 1.3575 1.3575 1.3575\n')
            result = import_structure(file, 3)
            self.assertEqual(result['symbols'], ['Si', 'Si'])
            self.assertEqual(len(result['cellAngstrom']), 3)
            file.write_text('1\nno cell\nSi 0 0 0\n')
            with self.assertRaises(ValueError):
                import_structure(file, 3)

    def test_units_occupations_and_point_count_are_verified(self):
        for text in [XML.replace('Hartree atomic units', 'eV'),
                     XML.replace('>fixed<', '>smearing<'),
                     XML.replace('<nks>2', '<nks>3'),
                     XML.replace('<occupations>1 0', '<occupations>0.5 0.5'),
                     XML.replace('<occupations>1 0</occupations>', '')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.read_xml(text)

    def test_resume_rejects_modified_checkpoint_summary(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'checkpoints').mkdir()
            file = root / 'checkpoints/base.json'
            atomic_json(file, {'sampledGapEv': 0.5, 'artifacts': {}})
            atomic_json(root / 'checkpoints/base.hash.json', {'sha256': sha256(file)})
            self.assertEqual(cached_case(root, 'base')['sampledGapEv'], 0.5)
            atomic_json(file, {'sampledGapEv': 5, 'artifacts': {}})
            with self.assertRaises(ValueError):
                cached_case(root, 'base')

    def test_incomplete_checkpoint_is_recalculated(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'checkpoints').mkdir()
            atomic_json(root / 'checkpoints/base.json', {'artifacts': {}})
            self.assertIsNone(cached_case(root, 'base'))

    def test_worker_signal_terminates_the_qe_process_group(self):
        for stop_signal in [signal.SIGTERM, signal.SIGHUP]:
            with self.subTest(signal=stop_signal), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                folder, evidence = root / 'runtime', root / 'evidence'
                folder.mkdir()
                evidence.mkdir()
                (folder / 'scf.in').write_text('process-control fixture, not QE physics input')
                executable = root / 'fake-qe.sh'
                executable.write_text('#!/bin/sh\necho $$ > qe.pid\nsleep 60 &\necho $! > qe-child.pid\nwait\n')
                executable.chmod(0o755)

                def entry():
                    worker.QE_EXECUTABLE = executable
                    worker.execute = lambda job, attempt, scratch: worker.run_qe(job, folder, evidence, 'scf',
                        {'threads': 1, 'maxSeconds': 60}, {'case': 'base', 'attempt': 1})
                    sys.argv = ['worker.py', 'run', str(root), '1']
                    try:
                        worker.main()
                    except worker.Canceled:
                        sys.exit(2)

                process = multiprocessing.get_context('fork').Process(target=entry)
                process.start()
                qe_pid = None
                try:
                    deadline = time.monotonic() + 10
                    while not (folder / 'qe-child.pid').exists() and time.monotonic() < deadline:
                        time.sleep(0.05)
                    qe_pid = int((folder / 'qe.pid').read_text())
                    child_pid = int((folder / 'qe-child.pid').read_text())
                    os.kill(process.pid, stop_signal)
                    process.join(10)
                    self.assertEqual(process.exitcode, 2, 'signal must enter worker cleanup')
                    for pid in [qe_pid, child_pid]:
                        stat = Path(f'/proc/{pid}/stat')
                        self.assertTrue(not stat.exists() or stat.read_text().split()[2] == 'Z', 'QE process group remains running')
                finally:
                    if process.is_alive():
                        process.kill()
                    process.join(10)
                    if qe_pid:
                        try:
                            os.killpg(qe_pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass


if __name__ == '__main__':
    unittest.main()
