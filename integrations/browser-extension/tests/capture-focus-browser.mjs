import {chromium} from 'playwright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const profile=await mkdtemp(path.join(os.tmpdir(),'checkly-focus-'));
const extension=path.resolve('dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const source=await context.newPage();await source.goto('data:text/html,<h1>capture source</h1>');
 const dataUrl=`data:image/png;base64,${(await source.screenshot()).toString('base64')}`;
 const sourceInfo=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return {tabId:tab.id,windowId:tab.windowId};});
 const id='12345678-1234-4234-8234-123456789012';
 const nextPage=context.waitForEvent('page');
 await worker.evaluate(async({id,dataUrl,sourceInfo})=>{await chrome.storage.session.set({['capture:'+id]:{dataUrl,...sourceInfo}});await chrome.tabs.create({url:chrome.runtime.getURL('capture.html#'+id),windowId:sourceInfo.windowId,openerTabId:sourceInfo.tabId});},{id,dataUrl,sourceInfo});
 const editor=await nextPage;
 const closed=editor.waitForEvent('close');await editor.getByRole('button',{name:'취소',exact:true}).click();await closed;
 const active=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab.id;});
 assert.equal(active,sourceInfo.tabId);console.log('PASS: closing capture editor restores captured tab');
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
