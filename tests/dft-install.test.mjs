import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile,readdir,rm,rmdir } from 'node:fs/promises';
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

test('pinned downloads recover from interrupted transfers and corrupt caches',{skip:process.platform!=='win32'},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'virtualfab-download-'));
  t.after(async()=>{for(const file of await readdir(root))await rm(path.join(root,file),{force:true});await rmdir(root);});
  const script=path.join(root,'check.ps1');
  await writeFile(script,String.raw`
param([string]$Repository, [string]$WorkRoot)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Expect-Failure($action) {
    try { & $action } catch { return }
    throw 'Expected the download to fail'
}
function Write-TestDownload($target) {
    $script:downloads++
    [IO.File]::WriteAllText($target, $script:payload)
    if ($script:interrupted) { throw 'Simulated connection interruption' }
}
function Invoke-WebRequest([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile) {
    Write-TestDownload $OutFile
}
function curl.exe {
    try { Write-TestDownload $args[([Array]::IndexOf($args, '-o') + 1)]; $global:LASTEXITCODE = 0 }
    catch { $global:LASTEXITCODE = 56 }
}
$reference = Join-Path $WorkRoot 'reference'
[IO.File]::WriteAllText($reference, 'verified archive')
$expectedHash = (Get-FileHash -LiteralPath $reference -Algorithm SHA256).Hash
foreach ($entry in @(
    @('solver/build.ps1', 'Get-PinnedArchive'),
    @('dft/setup.ps1', 'Get-PinnedFile')
)) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repository $entry[0]), [ref]$tokens, [ref]$errors)
    Assert ($errors.Count -eq 0) ('Installer syntax error: ' + $entry[0])
    $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $entry[1] }, $true)
    Assert ($null -ne $function) ('Missing download helper: ' + $entry[1])
    Invoke-Expression $function.Extent.Text
    $cache = Join-Path $WorkRoot ($entry[1] + '.zip')
    $script:downloads = 0
    $script:payload = 'partial archive'
    $script:interrupted = $true
    Expect-Failure { & $entry[1] 'https://example.invalid/archive' $cache $expectedHash 600 }
    Assert (-not (Test-Path -LiteralPath $cache)) 'Interrupted data was published as a cache'
    Assert (@(Get-ChildItem -LiteralPath $WorkRoot -Filter '*.partial').Count -eq 0) 'Failed download left temporary data'

    $script:payload = 'verified archive'
    $script:interrupted = $false
    & $entry[1] 'https://example.invalid/archive' $cache $expectedHash 600
    Assert ((Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash -eq $expectedHash) 'Retry did not recover'
    Assert ($script:downloads -eq 2) 'Retry must download again after interruption'

    $script:interrupted = $true
    & $entry[1] 'https://example.invalid/archive' $cache $expectedHash 600
    Assert ($script:downloads -eq 2) 'A valid cache must be reused without a download'
    Assert ((Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash -eq $expectedHash) 'Valid cached data changed'

    [IO.File]::WriteAllText($cache, 'corrupt old cache')
    $script:payload = 'wrong new archive'
    $script:interrupted = $false
    Expect-Failure { & $entry[1] 'https://example.invalid/archive' $cache $expectedHash 600 }
    Assert ([IO.File]::ReadAllText($cache) -eq 'corrupt old cache') 'Unverified data replaced the old cache'
    Assert (@(Get-ChildItem -LiteralPath $WorkRoot -Filter '*.partial').Count -eq 0) 'Checksum failure left temporary data'
    $script:payload = 'verified archive'
    & $entry[1] 'https://example.invalid/archive' $cache $expectedHash 600
    Assert ($script:downloads -eq 4) 'A corrupt cache must allow a fresh download'
    Assert ((Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash -eq $expectedHash) 'Corrupt cache was not repaired'
}
`);
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,path.resolve('.'),root],{windowsHide:true,stdio:'pipe'});
});
