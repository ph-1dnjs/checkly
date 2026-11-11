import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeCaptureEditor} from '../src/capture-focus.js';

test('activates the captured tab before closing the editor',async()=>{
 const calls=[];const tabs={get:async id=>{calls.push(['get',id]);return {id,windowId:7};},update:async(id,options)=>calls.push(['update',id,options])};
 await closeCaptureEditor({tabId:42,windowId:7},tabs,()=>calls.push(['close']));
 assert.deepEqual(calls,[['get',42],['update',42,{active:true}],['close']]);
});
test('closes safely when source is missing, moved to another window or from an older capture',async()=>{
 for(const scenario of ['missing','moved','old']){
  const calls=[];const tabs={get:async()=>{if(scenario==='missing')throw Error('closed');return {windowId:8};},update:async()=>calls.push('update')};
  await closeCaptureEditor(scenario==='old'?null:{tabId:42,windowId:7},tabs,()=>calls.push('close'));
  assert.deepEqual(calls,['close']);
 }
});
