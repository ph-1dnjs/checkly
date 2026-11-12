// Compiled extension UI with deterministic local data; no production login or upload.
import {chromium} from 'playwright-core';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('../..'),out=path.join(root,'outputs/recorder-design-review');await mkdir(out,{recursive:true});
const source=(await readdir(root)).find(n=>n.endsWith('Recorder 1.html'));if(!source)throw Error('Supplied Recorder HTML is required at repository root');
const browser=await chromium.launch({channel:'chromium',headless:true});
const reference=await browser.newPage({viewport:{width:1900,height:1000},deviceScaleFactor:1});
await reference.goto('file://'+path.join(root,source));await reference.getByRole('tab',{name:'동의 전',exact:true}).waitFor();
const states=[['login','로그인'],['consent','동의 전'],['idle','대기'],['recording','기록 중'],['list','기록 목록'],['preview','미리보기'],['help','도움말'],['more','더보기']];
const items=[];const failures=[];
try{for(const width of [380,560,760]){
 await reference.getByRole('radio',{name:width+'px',exact:true}).click();
 const aside=reference.locator('aside[aria-label="Checkly Recorder"]');const box=await aside.boundingBox();const height=Math.round(box.height)-48;
 for(const [state,label] of states){
  await reference.getByRole('tab',{name:label,exact:true}).click();await reference.waitForTimeout(300);
  const bounds=await aside.boundingBox();const refName=`${width}-${state}-reference.png`,appName=`${width}-${state}-implementation.png`;
  await reference.screenshot({path:path.join(out,refName),clip:{x:bounds.x,y:bounds.y+48,width:bounds.width,height:bounds.height-48}});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});page.on('pageerror',e=>failures.push(`${width}/${state}: ${e.message}`));
  await page.addInitScript(({state})=>{
   const team=state==='login'?null:{userId:'fixture-user',projectId:'fixture-project',nickname:'una'};
   const present=['list','preview','help','more'].includes(state);let consent=!['login','consent'].includes(state);
   const rec={id:'fixture-record',startedAt:new Date('2026-11-09T15:36:04+09:00').getTime(),url:'http://localhost:5177/login',trigger:{type:'xhr 오류',at:new Date('2026-11-09T15:36:14+09:00').getTime()},duration:15000,bytes:421888};
   // A real serialized DOM snapshot, not a placeholder or a screenshot of the reference.
   let nextId=1;
   const text=value=>({type:3,id:nextId++,textContent:value});
   const element=(tagName,attributes={},childNodes=[])=>({type:2,id:nextId++,tagName,attributes,childNodes});
   const body=element('body',{style:'margin:0;background:#f6f7f9;height:720px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;font:24px sans-serif'},[
    element('h1',{style:'color:#5a1e83'},[text('Demo Store')]),element('input',{value:'qa_user01',style:'width:320px;padding:16px'}),element('input',{placeholder:'비밀번호 입력',style:'width:320px;padding:16px'}),element('button',{style:'width:354px;background:#5a1e83;color:white;border:0;padding:16px'},[text('로그인')])
   ]);
   const snapshot={type:0,id:nextId++,childNodes:[element('html',{},[element('head'),body])]};
   const events=[{type:4,timestamp:rec.startedAt,data:{href:rec.url,width:960,height:720}},{type:2,timestamp:rec.startedAt,data:{node:snapshot,initialOffset:{left:0,top:0}}},{type:5,timestamp:rec.startedAt+15000,data:{tag:'clip-end',payload:{}}}];
   let statusCalls=0;
   const event={addListener(){}};
   window.chrome={storage:{local:{get:async key=>({[key]:key==='recordingConsentV2'?consent:null}),set:async v=>{if('recordingConsentV2'in v)consent=v.recordingConsentV2;},remove:async()=>{}},session:{get:async()=>({}),remove:async()=>{}}},runtime:{id:'fixture',onMessage:event,sendMessage:async m=>{
    if(m.type==='status')return {team,records:present&&(state!=='list'||statusCalls++>0)?[rec]:[],active:state==='recording'?[1]:[],metrics:{1:{startedAt:Date.now()-12000,counts:{clicks:4,navigations:1,errors:0}}},captures:[],sent:0};
    if(m.type==='preview')return {record:{session:{...rec,captureStartAt:rec.startedAt,captureEndAt:rec.startedAt+15000},documents:[{id:"fixture-doc",events}],logs:[]}};
    return {};
   }},tabs:{query:async()=>[{id:1,url:'http://localhost:5177/login'}],onActivated:event,onUpdated:event},windows:{onFocusChanged:event},permissions:{request:async()=>true}};
  },{state});
  await page.goto('file://'+path.resolve('dist/popup.html'));await page.waitForFunction(()=>!document.querySelector('#message').textContent.includes('처리 중'));
  if(state==='list'){await page.locator('#reload').click();await page.locator('.record').waitFor();}
  if(state==='preview'){await page.getByRole('button',{name:'기록 미리보기',exact:true}).click();await page.waitForSelector('#preview-root iframe');if((await page.locator('#preview-error').innerText()).trim()!=='')failures.push('preview replay error');}
  if(state==='help')await page.locator('#help-open').click();
  if(state==='more')await page.locator('#more').click();
  await page.waitForTimeout(300);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))failures.push(`${width}/${state}: horizontal overflow`);
  await page.screenshot({path:path.join(out,appName)});items.push({width,label,refName,appName});
  if(state==='preview'){await page.locator('#preview-play').click();await page.waitForTimeout(100);if(await page.locator('#player-control').getAttribute('aria-label')!=='일시정지')failures.push(`${width}: play toggle failed`);await page.locator('#player-control').click();}
  if(state==='list'){await page.locator('#select-all').check();if(!await page.locator('#send').isEnabled())failures.push(`${width}: bulk select failed`);}
  if(state==='help'){await page.locator('#help-close').click();if(await page.locator('#help').isVisible())failures.push(`${width}: help close failed`);}
  await page.close();
 }
 // Same underlying demo page screenshot for the capture editor, without substituting its toolbar.
 await reference.getByRole('tab',{name:'대기',exact:true}).click();await reference.waitForTimeout(300);
 const scene=reference.locator('aside[aria-label="Checkly Recorder"]').locator('..').locator(':scope > div').first();
 const sceneBox=await scene.boundingBox();const background=await scene.screenshot();
 await reference.getByRole('tab',{name:'화면 캡처',exact:true}).click();await reference.waitForTimeout(350);
 const refName=`${width}-capture-reference.png`,appName=`${width}-capture-implementation.png`;
 await scene.screenshot({path:path.join(out,refName)});
 const capture=await browser.newPage({viewport:{width:Math.round(sceneBox.width),height:Math.round(sceneBox.height)},deviceScaleFactor:1});
 capture.on('pageerror',e=>failures.push(`capture: ${e.message}`));
 await capture.addInitScript(({image})=>{window.chrome={storage:{session:{get:async key=>({[key]:{dataUrl:image}}),remove:async()=>{}}},tabs:{}};},{image:'data:image/png;base64,'+background.toString('base64')});
 await capture.goto('file://'+path.resolve('dist/capture.html')+'#12345678-1234-4234-8234-123456789012');
 await capture.getByRole('button',{name:'클립보드 복사',exact:true}).waitFor();
 await capture.waitForFunction(()=>!document.querySelector('.fa-capture-complete').disabled);
 await capture.screenshot({path:path.join(out,appName)});items.push({width,label:'화면 캡처',refName,appName});await capture.close();
}
const image=async name=>'data:image/png;base64,'+(await readFile(path.join(out,name))).toString('base64');let sections='';
for(const item of items)sections+=`<section><h2>${item.width}px · ${item.label}</h2><div class="pair"><figure><figcaption>HTML 시안 (Chrome 헤더 제외)</figcaption><img src="${await image(item.refName)}"></figure><figure><figcaption>빌드된 확장 UI · 테스트 데이터</figcaption><img src="${await image(item.appName)}"></figure></div></section>`;
await writeFile(path.join(out,'comparison.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Checkly Recorder 화면 비교</title><style>body{font:14px system-ui;background:#eef0f3;padding:24px;color:#18202a}h1{font-size:24px}section{margin:24px 0;padding:20px;background:white;border-radius:12px}.pair{display:flex;gap:20px;align-items:flex-start;overflow:auto}figure{margin:0;flex:none}figcaption{margin-bottom:8px;color:#596473}img{display:block;border:1px solid #ddd;max-width:100%}p{max-width:1000px;line-height:1.6}</style><h1>Checkly Recorder · 시안 / 구현 비교</h1><p>380·560·760px, 패널 8개 상태와 캡처 편집기. 실제 서비스 계정 대신 고정 테스트 데이터를 사용한 빌드 UI입니다. 시안의 가상 재생 이미지, 개인정보 안내, 저장 범위, 버전·프로젝트 표시와 구현은 다릅니다. 미리보기에는 실제 DOM 스냅샷으로 만든 테스트 페이지를 재생합니다. 시안의 가상 썸네일과 재생 내용은 다릅니다.</p>${sections}</html>`);
const gallery=await browser.newPage({viewport:{width:1320,height:1400}});
for(const width of [380,560,760]){
 let cards='';for(const i of items.filter(i=>i.width===width))cards+=`<article><h3>${i.label} · 시안 / 구현</h3><div><img src="${await image(i.refName)}"><img src="${await image(i.appName)}"></div></article>`;
 await gallery.setContent(`<style>body{font:13px system-ui;background:#dde2e8;margin:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}article{background:white;padding:6px}h3{margin:4px}article div{display:flex;align-items:flex-start}img{width:50%;height:auto;max-height:410px;object-fit:contain;object-position:top}</style>${cards}`);
 await gallery.screenshot({path:path.join(out,`overview-${width}.png`),fullPage:true});
}
await gallery.close();
console.log(JSON.stringify({screens:items.length,failures,report:path.join(out,'comparison.html')},null,2));if(failures.length)process.exitCode=1;
}finally{await browser.close();}
