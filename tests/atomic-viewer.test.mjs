import test from 'node:test';
import assert from 'node:assert/strict';
import { drawAtomicBands } from '../src/atomic-viewer.js';

test('disconnected band-path endpoints share one readable axis label',()=>{
  const container={innerHTML:''};
  drawAtomicBands(container,{x:[0,1,1,2],ticks:[0,1,1,2],labels:['G','K','U','X'],
    referenceEv:0,energiesEv:[[-1,1],[-0.3,2],[-0.3,1.8],[-1,1.4]]},1);
  assert.match(container.innerHTML,/>K\|U<\/text>/);
  assert.doesNotMatch(container.innerHTML,/>K<\/text>|>U<\/text>/);
  assert.match(container.innerHTML,/aria-label="DFT 晶体能带"/);
});
