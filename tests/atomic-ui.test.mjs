import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicUI } from '../src/atomic-ui.js';
import { atomicTemplate,dftSnapshot } from '../src/atomic.js';

test('a foreign active task disappearing clears its task display and controls',async()=>{
  const elements=new Map(),original=globalThis.document;
  globalThis.document={querySelector(selector){
    if(!elements.has(selector))elements.set(selector,{textContent:'',innerHTML:'',value:'',disabled:false,
      classList:{add(){},remove(){},toggle(){}}});
    return elements.get(selector);
  }};
  try{
    const id='00000000-0000-4000-8000-000000000000',config=atomicTemplate();
    const info={id,status:{state:'running'},log:'old QE log',manifest:{config:dftSnapshot(config)}};
    let list=[info];
    const ui=Object.assign(Object.create(AtomicUI.prototype),{generation:1,selected:'',config:()=>config,
      api:{list:async()=>list,inspect:async()=>info}});
    await ui.refresh();
    assert.match(elements.get('#atomic-status').textContent,/运行中/);
    const taskOptions=elements.get('#atomic-jobs').innerHTML;
    list=[];
    await ui.refresh();
    assert.equal(ui.selected,'');assert.equal(ui.info,null);assert.equal(ui.localRunning,false);
    assert.equal(elements.get('#atomic-status').textContent,'尚未计算');
    for(const selector of ['#atomic-binding','#atomic-log-text','#atomic-provenance-text'])assert.equal(elements.get(selector).textContent,'');
    for(const selector of ['#atomic-result','#atomic-band-plot'])assert.equal(elements.get(selector).innerHTML,'');
    assert.equal(elements.get('#atomic-cancel').disabled,true);
    assert.equal(elements.get('#atomic-resume').disabled,true);
    assert.equal(elements.get('#atomic-reveal').disabled,true);
    assert.match(taskOptions,/其他项目/);
  }finally{globalThis.document=original;}
});
