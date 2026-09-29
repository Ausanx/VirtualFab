import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('QE Bash installer retains LF on an autocrlf Windows checkout',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'virtualfab-checkout-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
  git('init','--quiet');git('config','core.autocrlf','true');
  await mkdir(path.join(root,'dft'));
  await writeFile(path.join(root,'dft/install-qe.sh'),await readFile(new URL('../dft/install-qe.sh',import.meta.url)));
  try{
    await writeFile(path.join(root,'.gitattributes'),await readFile(new URL('../.gitattributes',import.meta.url)));
    git('add','--','.gitattributes');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  git('add','--','dft/install-qe.sh');
  git('checkout-index','--all','--prefix=checkout/');
  const checkedOut=await readFile(path.join(root,'checkout/dft/install-qe.sh'),'utf8');
  assert.equal(checkedOut.includes('\r'),false,'CRLF makes Bash interpret pipefail as pipefail\\r');
});
