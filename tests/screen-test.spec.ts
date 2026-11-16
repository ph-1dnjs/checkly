import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

async function capture(page: Page, name: string) {
  if (!process.env.CHECKLY_SCREEN_TEST_OUTPUT) return;
  await mkdir(process.env.CHECKLY_SCREEN_TEST_OUTPUT, {recursive:true});
  await page.screenshot({path:path.join(process.env.CHECKLY_SCREEN_TEST_OUTPUT,`${name}.png`)});
}

async function installScreenStub(page: Page) {
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    const off = () => () => {};
    const record = (name: string, ...args: unknown[]) => { calls.push([name, ...args]); sessionStorage.setItem('screen-calls', JSON.stringify(calls)); };
    const at = 1794787200000;
    const url = 'https://demo.test/login';
    const session = { id:'record-1',title:'Demo Store',url,source:'browser',startedAt:at,endedAt:at+10000,status:'saved',eventCount:4,bytes:4096,notes:'로그인 오류 확인',trigger:{type:'resource-error',at:at+5000,url},captureStartAt:at,captureEndAt:at+10000 };
    let sessions = [session];
    const events = [
      {type:4,timestamp:at,data:{href:url,width:900,height:600}},
      {type:2,timestamp:at+1,data:{initialOffset:{left:0,top:0},node:{type:0,id:1,childNodes:[{type:1,id:2,name:'html',publicId:'',systemId:''},{type:2,id:3,tagName:'html',attributes:{},childNodes:[{type:2,id:4,tagName:'head',attributes:{},childNodes:[]},{type:2,id:5,tagName:'body',attributes:{style:'margin:0;background:#f7f8fa;padding:60px;font:20px sans-serif'},childNodes:[{type:2,id:6,tagName:'h1',attributes:{},childNodes:[{type:3,id:7,textContent:'Demo Store · 기록 재생'}]}]}]}]}}},
      {type:3,timestamp:at+5000,data:{source:2,type:2,id:6,x:100,y:80}},
      {type:3,timestamp:at+10000,data:{source:3,id:5,x:0,y:0}},
    ];
    const log = {id:'log-1',browser_session_id:'default',source:'browser',kind:'fetch',occurred_at:new Date(at+2000).toISOString(),url:'https://demo.test/api/login',page_url:url,method:'POST',status:401,duration_ms:52,is_error:true,payload:{request:{state:'captured',text:'{"username":"qa"}'},response:{state:'captured',text:'{"message":"로그인 실패"}'},responseContentType:'application/json'}};
    let streaming = false;
    let running = false;
    let frameListener: ((frame: unknown) => void) | undefined;
    let nativeRules: unknown[] = [];
    const emitFrame = () => frameListener?.({udid:'test-device',width:390,height:844,dataUrl:'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="white"/><text x="40" y="70" font-size="24">Demo App</text><rect x="30" y="700" width="330" height="50" rx="25" fill="#f3f5f7"/></svg>')});
    Object.defineProperty(window,'electronAPI',{value:{
      onManualInputRequired:off,onManualControlRequired:off,onManualResultRequired:off,onQaProgress:off,onQaPreview:off,onQaStepPreview:off,onRunVideo:off,
      loadFormAutomationState:async()=>({version:1,values:{}}),setFormAutomationState:async(key:string,value:unknown)=>record('save',key,value),
      readFormAutomationSessionEvents:async()=>[],saveFormAutomationSessionEvent:async()=>true,
      liveSession:{list:async(scope:string)=>({sessions,mode:'team',uploadableIds:sessions.map(s=>s.id)}),read:async(id:string,scope:string)=>{record('read',id,scope);return {session,documents:[{id:'doc-1',title:'Demo Store',url,events}],logs:[log]};},onChanged:off,
        downloadVideo:async(...args:unknown[])=>{record('downloadVideo',...args);return '/tmp/checkly-test.mp4';},upload:async(ids:string[])=>{record('upload',ids);return {uploaded:ids,failed:[]};},remove:async(id:string,scope:string)=>{record('remove',id,scope);sessions=sessions.filter(s=>s.id!==id);}},
      simulatorDevices:async()=>[{udid:'test-device',name:'iPhone Test',state:'Booted',runtime:'iOS Test'}],simulatorStatus:async()=>({udid:streaming?'test-device':null,streaming,error:''}),
      simulatorHasIdb:async()=>true,connectSimulator:async()=>{streaming=true;emitFrame();record('connect');},disconnectSimulator:async()=>{streaming=false;record('disconnect');},
      onSimulatorFrame:(listener:(frame:unknown)=>void)=>{frameListener=listener;return()=>{frameListener=undefined;};},
      startNativeInspector:async()=>{running=true;},stopNativeInspector:async()=>{running=false;},
      simulatorApps:async()=>[{bundleId:'dev.demo',name:'Demo App'}],launchSimulatorApp:async(...args:unknown[])=>record('launch',...args),
      nativeInspectorSnapshot:async()=>({running,port:4319,revision:1,clients:running?[{id:'dev.demo',name:'Demo App',lastSeen:Date.now(),revision:1}]:[],events:running?[{id:'native-1',type:'fetch',url:'https://demo.test/api/config',method:'GET',status:200,responseBody:{enabled:true},at:new Date().toISOString(),elapsed:15,browserSessionId:'dev.demo'}]:[]}),
      simulatorInput:async(...args:unknown[])=>record('input',...args),setNativeInspectorRules:async(rules:unknown[])=>{nativeRules=rules;record('rules',nativeRules);},
      saveReactNativeModule:async()=>{record('module');return '/tmp/checkly.js';},copyFormAutomationText:async(value:string)=>record('copy',value),copyFormAutomationImage:async(value:string)=>record('image',value.slice(0,30)),
    }});
  });
}

test('matches the reference layout and keeps controls reachable at desktop sizes',async({page})=>{
  await installScreenStub(page);await page.goto('/');await page.getByRole('button',{name:'화면 테스트',exact:true}).click();
  for (const [width,height] of [[1440,1000],[1280,720],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await expect(page.locator('.fa-screen-header')).toHaveJSProperty('clientHeight',51);
    expect((await page.locator('.fa-inspector').boundingBox())?.width).toBe(440);
    expect((await page.locator('.fa-session-bar').boundingBox())?.height).toBe(44);
    expect((await page.locator('.fa-browser-toolbar').boundingBox())?.height).toBe(48);
    const footer=await page.locator('.fa-inspector-footer').boundingBox();expect(footer!.y+footer!.height).toBe(height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole('button',{name:'보기 설정',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'보기 설정',exact:true})).toBeVisible();
    await page.getByLabel('미리보기 화면 크기').selectOption('mobile');
    await expect(page.getByRole('button',{name:'가로·세로 전환'})).toBeVisible();await page.keyboard.press('Escape');
  }
  await page.getByRole('tab',{name:/응답 오버라이드/}).click();
  await page.getByRole('button',{name:'네트워크에서 응답 고르기'}).click();await expect(page.getByRole('tab',{name:'네트워크',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/응답 오버라이드/}).click();await page.getByRole('button',{name:'직접 만들기'}).click();
  await expect(page.getByLabel('오버라이드 API 경로')).toHaveValue('/api/example');
  await page.getByLabel('오버라이드 요청 메서드').selectOption('POST');await page.getByRole('button',{name:'400 잘못된 요청'}).click();
  await page.getByRole('button',{name:'바꾼 응답 목록',exact:true}).click();await expect(page.locator('.fa-rule-card')).toContainText('POST');await expect(page.locator('.fa-rule-card')).toContainText('400');
});

test('recording replay, timeline, MP4, upload and deletion remain connected',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await installScreenStub(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/');await page.getByRole('button',{name:'화면 테스트',exact:true}).click();await page.getByRole('button',{name:'브라우저 기록',exact:true}).click();
  await capture(page,'recordings-list');
  await expect(page.locator('.form-automation-workbench')).toHaveJSProperty('inert',true);
  await expect(page.getByRole('button',{name:'화면 테스트',exact:true})).toBeVisible();
  await page.locator('.ls-session-open').click();await expect(page.frameLocator('.replayer-wrapper iframe').getByText('Demo Store · 기록 재생')).toBeVisible();
  await capture(page,'recordings-playback');
  await page.getByRole('button',{name:'재생',exact:true}).click();await expect.poll(async()=>Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(0);await page.getByRole('button',{name:'일시정지'}).click();
  await page.getByLabel('재생 속도').selectOption('2');await page.getByRole('group',{name:'타임라인 필터'}).getByRole('button',{name:'API',exact:true}).click();
  await page.locator('.ls-activities>button').filter({hasText:'POST 401'}).click();await expect(page.locator('.ls-api-detail')).toContainText('로그인 실패');
  await page.getByRole('button',{name:'MP4 다운로드',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'MP4 저장 완료'})).toBeVisible();
  await page.getByLabel('로컬 기록 전체 선택').check();await capture(page,'recordings-selected');await page.getByRole('button',{name:'서버로 보내기'}).click();await expect(page.getByRole('status').filter({hasText:'1개 전송 완료'})).toBeVisible();
  await page.getByRole('button',{name:'서버',exact:true}).click();await page.getByLabel('서버 기록 전체 선택').check();await page.getByRole('button',{name:'선택 삭제'}).click();
  await page.getByRole('button',{name:'선택한 1개 삭제 확인',exact:true}).click();await expect(page.locator('.ls-session-row')).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'1개 기록을 삭제했어요'})).toBeVisible();
  const calls=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('screen-calls')||'[]'));expect(calls).toContainEqual(['remove','record-1','team']);expect(calls).toContainEqual(['downloadVideo','record-1','doc-1','local']);expect(errors).toEqual([]);
});

test('mobile controls send the original IPC commands after the redesign',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await installScreenStub(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/');await page.getByRole('button',{name:'화면 테스트',exact:true}).click();await page.getByRole('button',{name:'모바일 앱',exact:true}).click();
  await expect(page.locator('.fa-native-steps li')).toHaveCount(3);await capture(page,'mobile-off');await page.getByRole('button',{name:'연결',exact:true}).click();await expect(page.getByAltText('iOS 앱 실시간 화면')).toBeVisible();
  await capture(page,'mobile-on');
  await page.getByRole('button',{name:'앱 열기',exact:true}).click();await page.getByRole('button',{name:'앱 재시작',exact:true}).click();await page.getByLabel('앱에 입력할 텍스트').fill('테스트 입력');await page.getByRole('button',{name:'입력',exact:true}).click();
  await page.getByAltText('iOS 앱 실시간 화면').click();
  await page.locator('.fa-request-row').first().click();await expect(page.getByRole('table',{name:'실제 응답'})).toContainText('enabled');await page.getByRole('tab',{name:'요청',exact:true}).click();await expect(page.getByRole('table',{name:'요청 정보'})).toContainText('메서드');await expect(page.getByRole('table',{name:'요청 정보'})).toContainText('주소');await expect(page.getByRole('table',{name:'요청 정보'})).toContainText('세션');
  await page.getByRole('button',{name:'이 응답 바꿔 보기'}).click();await page.getByRole('button',{name:'400 잘못된 요청'}).click();await page.getByRole('button',{name:'저장 및 적용'}).click();
  await page.getByRole('button',{name:'화면 캡처'}).click();await expect(page.getByRole('dialog',{name:'화면 캡처 편집'})).toBeVisible();await capture(page,'mobile-capture');await page.getByRole('button',{name:'취소',exact:true}).click();
  await page.getByRole('button',{name:'연결 해제',exact:true}).click();
  const calls=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('screen-calls')||'[]'));expect(calls).toContainEqual(['input','test-device',{type:'text',text:'테스트 입력'}]);expect(calls).toContainEqual(['launch','test-device','dev.demo',true]);expect(calls.some((call:unknown[])=>call[0]==='rules')).toBe(true);expect(errors).toEqual([]);
  const tap=calls.find((call:unknown[])=>call[0]==='input' && (call[2] as {type:string}).type==='tap')[2];expect(tap.x).toBeCloseTo(0.5,2);expect(tap.y).toBeCloseTo(0.5,2);
});

test('record trash deletes immediately in each storage scope', async ({page}) => {
  await installScreenStub(page); await page.goto('/'); await page.getByRole('button',{name:'화면 테스트',exact:true}).click(); await page.getByRole('button',{name:'브라우저 기록',exact:true}).click();
  await capture(page,'recordings-empty');
  const icon=page.locator('.ls-detail-empty .ls-empty-icon'); const box=await icon.boundingBox(); const child=await icon.locator('.msi').boundingBox();
  expect(Math.abs((box!.x+box!.width/2)-(child!.x+child!.width/2))).toBeLessThan(1);
  expect(Math.abs((box!.y+box!.height/2)-(child!.y+child!.height/2))).toBeLessThan(1);
  await page.getByRole('button',{name:'Demo Store 로컬에서 삭제'}).click(); await expect(page.locator('.ls-session-row')).toHaveCount(0); await expect(page.getByRole('status').filter({hasText:'1개 기록을 삭제했어요'})).toBeVisible(); await expect(page.locator('.ls-delete-toast')).toBeHidden({timeout:5000});
  let calls=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('screen-calls')||'[]')); expect(calls).toContainEqual(['remove','record-1','local']);
  await page.reload(); await page.getByRole('button',{name:'화면 테스트',exact:true}).click(); await page.getByRole('button',{name:'브라우저 기록',exact:true}).click();
  await page.getByRole('button',{name:'서버',exact:true}).click(); const serverDelete=page.getByRole('button',{name:'Demo Store 서버에서 삭제'}); await expect(serverDelete.locator('.msi')).toHaveText('delete'); await serverDelete.click(); await expect(page.locator('.ls-session-row')).toHaveCount(0);
  calls=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('screen-calls')||'[]')); expect(calls).toContainEqual(['remove','record-1','team']);
});
