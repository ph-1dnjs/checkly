import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const server=createServer((req,res)=>{if(req.url==='/api'){res.writeHead(401,{'content-type':'application/json'});res.end('{"reason":"visible error"}');}else{res.setHeader('content-type','text/html');res.end('<html><body><h1>VISIBLE SCREEN TEXT</h1><input id="password" type="password"></body></html>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.addInitScript(()=>{window.messages=[];window.chrome={runtime:{sendMessage:async m=>{window.messages.push(m);return m.type==='hello'?{sessionId:'test'}:{};},onMessage:{addListener:()=>{}}}};});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({path:'dist/hook.js'});await page.addScriptTag({path:'dist/content.js'});
 await page.locator('#password').fill('VISIBLE_PASSWORD');
 await page.evaluate(()=>fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'visible@example.com'})}));
 await page.waitForFunction(()=>window.messages.some(m=>m.event?.payload?.response?.text?.includes('visible error'))&&window.messages.some(m=>m.type==='batch'&&JSON.stringify(m.batch).includes('VISIBLE_PASSWORD')));
 await page.evaluate(()=>new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api');xhr.onloadend=resolve;xhr.send('xhr-visible=1');}));
 await page.waitForFunction(()=>window.messages.some(m=>m.event?.type==='xhr'&&m.event?.payload?.response?.text?.includes('visible error')));
 const messages=await page.evaluate(()=>window.messages);const log=messages.find(m=>m.event?.payload?.response?.text?.includes('visible error')).event;
 assert.match(log.payload.request.text,/visible@example.com/);assert.equal(log.status,401);
 const xhr=messages.find(m=>m.event?.type==='xhr').event;assert.equal(xhr.payload.request.text,'xhr-visible=1');assert.match(xhr.payload.response.text,/visible error/);
 assert.ok(messages.some(m=>m.type==='batch'&&JSON.stringify(m.batch).includes('VISIBLE SCREEN TEXT')));
 console.log('PASS: visible text, password input and fetch request/response are recorded');
}finally{await browser.close();server.close();}
