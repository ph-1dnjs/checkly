import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Real Electron + isolated local fixture. Never uses the user's profile or team DB.
async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-screen-test-"));
  const output = process.env.CHECKLY_SCREEN_TEST_OUTPUT || path.join(tmpdir(), "checkly-screen-test-results");
  await mkdir(output, { recursive: true });
  const html = await readFile("tests/fixtures/screen-test.html", "utf8");
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/platform/config')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { count: 1 } })); }
    else if (req.url === '/auth/login') { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'fail', message: '아이디 또는 비밀번호가 틀렸어요' })); }
    else { res.setHeader('content-type', 'text/html'); res.end(html); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const url = `${origin}/login`;
  const fieldMeta = ['username', 'password', 'remember'].map((name, index) => ({ name, label: ['아이디', '비밀번호', '아이디 저장'][index], type: ['text', 'password', 'checkbox'][index], required: false, placeholder: '', minLength: 0, maxLength: 0, min: '', max: '', pattern: '', accept: '', multiple: false, context: 'form', options: [] }));
  await writeFile(path.join(dir, 'form-automation-state.json'), JSON.stringify({version:1,values:{
    'checkly-form-target-url': url, 'checkly-form-browser-zoom':100,
    'checkly-form-browser-sessions':[{id:'default',name:'회원 세션 2',browserIdentity:'chrome',url,currentPageUrl:url,state:'loading',history:{back:false,forward:false}}],
    'checkly-form-saved-cases':[{id:'saved-login',name:'개발 로그인',kind:'success',generated:false,userSaved:true,screen:'/login',fieldMode:'name',fields:{username:'opi1228',password:'qa-password',remember:true},fieldMeta,expected:'로그인',pageScope:url,pageUrl:url}]
  }}));
  const env = { ...process.env, CHECKLY_SUPABASE_URL: "", CHECKLY_SUPABASE_ANON_KEY: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`, '--force-device-scale-factor=1'], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    await app.evaluate(({BrowserWindow}) => { BrowserWindow.getAllWindows()[0].setContentSize(1440,1000); });
    const errors: string[] = []; page.on('pageerror',error=>{ errors.push(error.message); console.error('Renderer:',error.message); });
    await page.getByRole('button',{name:'화면 테스트',exact:true}).click();
    const guest = <T,>(script:string):Promise<T> => page.locator('webview.active').evaluate((element,code)=>(element as HTMLElement & { executeJavaScript:(s:string)=>Promise<T> }).executeJavaScript(code),script);
    await expect.poll(()=>guest<string>('document.title')).toBe('Demo Store');
    await expect(page.locator('.fa-field-chips>span')).toHaveCount(3);
    console.log('Webview geometry:',await guest('[innerWidth,innerHeight,devicePixelRatio,document.querySelector("main").getBoundingClientRect().width]'));
    await page.screenshot({scale:'css',path:path.join(output,'first-use.png')});
    await page.getByRole('button',{name:'폼 입력 안내 닫기'}).click();
    await page.getByRole('button',{name:/개발 로그인/}).click();
    await expect.poll(()=>guest<number>("document.querySelector('[data-checkly-form-hints]')?.shadowRoot?.querySelectorAll('span').length ?? 0")).toBe(6);
    await expect(page.getByLabel('아이디 값')).toHaveValue('opi1228');
    await expect.poll(()=>guest<string>("document.querySelector('[name=password]').value")).toBe('');
    await page.screenshot({scale:'css',path:path.join(output,'form.png')});
    await page.getByRole('button',{name:'3칸 입력하기'}).click();
    await expect.poll(()=>guest<string>("document.querySelector('[name=password]').value")).toBe('qa-password');
    await page.getByLabel('비밀번호 자동 입력').uncheck();
    await page.getByLabel('아이디 값').fill('changed_user');
    await page.getByRole('button',{name:'2칸 입력하기'}).click();
    await expect.poll(()=>guest<string[]>("[document.querySelector('[name=username]').value,document.querySelector('[name=password]').value]")).toEqual(['changed_user','qa-password']);
    await page.getByRole('button',{name:'케이스에 저장',exact:true}).click();
    await expect.poll(async()=>JSON.stringify((await page.evaluate(()=>window.electronAPI.loadFormAutomationState())).values)).toContain('changed_user');
    await page.getByRole('button',{name:'선택 필드 초기화',exact:true}).click();
    await expect.poll(()=>guest<string[]>("[document.querySelector('[name=username]').value,document.querySelector('[name=password]').value]")).toEqual(['','qa-password']);
    await page.getByRole('button',{name:'지금 화면 값으로 새 케이스'}).click();
    await expect(page.getByLabel('아이디 값')).toHaveValue('');
    await expect(page.getByLabel('비밀번호 값')).toHaveValue('qa-password');
    await expect.poll(async()=>JSON.stringify((await page.evaluate(()=>window.electronAPI.loadFormAutomationState())).values)).toContain('새 케이스');
    await page.getByRole('button',{name:'보기 설정',exact:true}).click();
    await page.getByLabel('미리보기 화면 크기').selectOption('mobile');
    await expect.poll(()=>guest<number[]>('[innerWidth,innerHeight]')).toEqual([390,844]);
    await page.getByRole('button',{name:'화면 확대',exact:true}).click();
    await expect.poll(()=>guest<number[]>('[innerWidth,innerHeight]')).toEqual([390,844]);
    await page.getByRole('button',{name:'가로·세로 전환',exact:true}).click();
    await expect.poll(()=>guest<number[]>('[innerWidth,innerHeight]')).toEqual([844,390]);
    await page.getByLabel('미리보기 화면 크기').selectOption('desktop');
    await page.getByRole('button',{name:'105%',exact:true}).click();
    await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:/네트워크/}).click();
    await expect.poll(()=>guest<number>("document.querySelectorAll('[data-checkly-form-hints]').length")).toBe(0);
    await expect(page.locator('.fa-request-row').filter({hasText:'/platform/config'}).first()).toBeVisible();
    await page.screenshot({scale:'css',path:path.join(output,'network.png')});
    await page.locator('.fa-request-row').filter({hasText:'/platform/config'}).first().click();
    await expect(page.getByRole('region',{name:'API 요청 상세'})).toBeVisible();
    await page.screenshot({scale:'css',path:path.join(output,'request.png')});
    await page.getByRole('button',{name:'이 응답 바꿔 보기',exact:true}).click();
    await page.getByRole('button',{name:'항목으로',exact:true}).click();
    await page.screenshot({scale:'css',path:path.join(output,'override-fields.png')});
    await page.getByRole('button',{name:'JSON',exact:true}).click();
    await page.locator('.fa-override-json').fill('{"status":"overridden","data":{"count":42}}');
    await page.getByRole('button',{name:'저장 및 적용',exact:true}).click();
    await expect.poll(()=>guest<{body:{data:{count:number}}}>('window.loadConfig()')).toMatchObject({body:{data:{count:42}}});
    await page.screenshot({scale:'css',path:path.join(output,'override.png')});
    await page.getByRole('button',{name:'바꾼 응답 목록',exact:true}).click();
    await page.screenshot({scale:'css',path:path.join(output,'override-list.png')});
    await page.getByRole('switch').click();
    await expect.poll(()=>guest<{body:{data:{count:number}}}>('window.loadConfig()')).toMatchObject({body:{data:{count:1}}});
    await page.getByRole('switch').click();
    await expect.poll(()=>guest<{body:{data:{count:number}}}>('window.loadConfig()')).toMatchObject({body:{data:{count:42}}});
    await page.getByRole('button',{name:'편집',exact:true}).click();
    await page.getByRole('button',{name:'규칙 상태·고급 설정',exact:true}).click();
    await page.getByRole('button',{name:'초기화',exact:true}).click();
    await page.keyboard.press('Escape');
    await expect.poll(()=>guest<{body:{data:{count:number}}}>('window.loadConfig()')).toMatchObject({body:{data:{count:1}}});
    await guest("document.querySelector('form').requestSubmit()");
    await page.getByRole('button',{name:'브라우저 기록',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'브라우저 기록',exact:true})).toBeVisible();
    await page.screenshot({scale:'css',path:path.join(output,'recordings.png')});
    await expect.poll(async()=> (await page.evaluate(()=>window.electronAPI.liveSession.list('local'))).sessions.some(item=>item.status==='saved'),{timeout:20_000}).toBe(true);
    await expect(page.locator('.ls-session-open').first()).toBeEnabled({timeout:20_000});
    await page.locator('.ls-session-open').first().click();
    await expect(page.locator('.replayer-wrapper iframe')).toBeVisible();
    await expect(page.frameLocator('.replayer-wrapper iframe').getByRole('heading',{name:'Demo Store',exact:true})).toBeVisible();
    await page.screenshot({scale:'css',path:path.join(output,'playback.png')});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'새 세션',exact:true}).click();
    await page.getByRole('button',{name:'새 세션 열기',exact:true}).click();
    await page.getByLabel(/탭 이름$/).fill('독립 세션'); await page.getByLabel(/탭 이름$/).press('Enter');
    await expect(page.getByRole('tab',{name:/독립 세션/})).toBeVisible();
    await expect.poll(()=>guest<string>('document.title')).toBe('Demo Store');
    await page.getByRole('button',{name:'화면 분할',exact:true}).click();
    await expect(page.locator('.fa-browser-pane.visible')).toHaveCount(2);
    await page.screenshot({scale:'css',path:path.join(output,'split.png')});
    await page.getByRole('button',{name:'분할 해제',exact:true}).click();
    await page.getByRole('button',{name:'화면 캡처',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'화면 캡처 편집',exact:true})).toBeVisible();
    await page.screenshot({scale:'css',path:path.join(output,'capture.png')});
    await page.getByRole('button',{name:'취소',exact:true}).click();
    await page.reload();
    await page.getByRole('button',{name:'화면 테스트',exact:true}).click();
    await expect(page.getByRole('tab',{name:/독립 세션/})).toBeVisible();
    await expect(page.locator('.fa-case-card').filter({hasText:'개발 로그인'})).toBeVisible();
    await page.locator('.fa-case-card').filter({hasText:'개발 로그인'}).click();
    await expect(page.getByLabel('아이디 값')).toHaveValue('changed_user');
    expect(errors).toEqual([]);
    console.log('PASS: real webview discovery/hints, explicit fill, excluded fields, save/reload, current-value case, reset, viewport/zoom/rotation, network detail, override/apply/toggle/reset, saved error recording/replay, isolated sessions/split, capture. Screenshots:',output);
  } catch (error) {
    const page = app && await app.firstWindow();
    await page?.screenshot({scale:'css',path:path.join(output,'failure.png')});
    console.error(await page?.locator('webview').evaluateAll(elements=>elements.map(element=>({src:element.getAttribute('src'),size:element.getBoundingClientRect().toJSON()}))));
    throw error;
  } finally { await app?.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); await rm(dir,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
