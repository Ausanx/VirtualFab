import { spawn } from 'node:child_process';
import path from 'node:path';
import { wslPath } from '../dft/jobs.mjs';

const child=spawn('wsl.exe',['-d','VirtualFab-QE','-u','root','--exec','python3',wslPath(path.resolve('tests/dft_core.py'))],{stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('close',code=>{process.exitCode=code??1;});
