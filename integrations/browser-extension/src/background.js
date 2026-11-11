import {recordingStatusKey,activeCaptures} from './recording-status.js';
import {createClient} from '@supabase/supabase-js';
import {config} from './config.js';
import {addBatch,addLog,finish,bytes,uploadRecording,setRecordingNotes} from './core.js';
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
async function captureTab(tab){if(!Number.isInteger(tab?.id)||!Number.isInteger(tab?.windowId))throw Error('캡처할 탭을 선택하세요.');const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});const id=crypto.randomUUID(),key='capture:'+id;await chrome.storage.session.set({[key]:{dataUrl:image,tabId:tab.id,windowId:tab.windowId}});try{await chrome.tabs.create({url:chrome.runtime.getURL('capture.html#'+id),windowId:tab.windowId,openerTabId:tab.id});}catch(error){await chrome.storage.session.remove(key);throw error;}}
chrome.commands.onCommand.addListener((command,tab)=>{if(command==='capture-screen')void captureTab(tab).catch(error=>{console.error('화면 캡처 실패:',error);void chrome.tabs.create({url:chrome.runtime.getURL('capture.html#capture-failed')});});});
const ready=chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const client=createClient(config.url,config.anonKey,{auth:{storage:{getItem:async k=>(await chrome.storage.session.get(k))[k]??null,setItem:async(k,v)=>{await ready;await chrome.storage.session.set({[k]:v});},removeItem:async k=>{await chrome.storage.session.remove(k);}},persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})}});
const db=new Promise((resolve,reject)=>{const r=indexedDB.open('checkly',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
let lastStatusKey='';
const notify=message=>{void chrome.runtime.sendMessage(message).catch(()=>{});};
function notifyChange(state){const key=recordingStatusKey(state);if(key!==lastStatusKey){lastStatusKey=key;notify({type:'recordings-changed',captures:activeCaptures(state)});}}
async function storage(write){const d=await db;return new Promise((resolve,reject)=>{const t=d.transaction('state',write?'readwrite':'readonly');const r=write?t.objectStore('state').put(write,'data'):t.objectStore('state').get('data');let result;r.onsuccess=()=>result=r.result;t.oncomplete=()=>{if(write)notifyChange(write);resolve(write||result||{active:{},pending:[],sent:0});};t.onerror=()=>{if(write)notify({type:'recording-storage-error'});reject(t.error);};t.onabort=()=>{if(write)notify({type:'recording-storage-error'});reject(t.error||Error('로컬 저장이 취소되었습니다.'));};});}
let chain=Promise.resolve();const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
async function member(){const {data,error}=await client.auth.getSession();if(error)throw error;if(!data.session)return null;const result=await client.from('members').select('user_id,project_id,nickname').eq('user_id',data.session.user.id).single();if(result.error)throw result.error;return {userId:result.data.user_id,projectId:result.data.project_id,nickname:result.data.nickname};}
const same=(a,b)=>a&&b&&a.userId===b.userId&&a.projectId===b.projectId;
function complete(s,a){const clip=finish(a);if(clip&&clip.documents.length){if(s.pending.length>=20||bytes(s.pending)+bytes(clip)>40_000_000){s.error='로컬 기록 공간이 가득 찼습니다. 기록을 전송하거나 삭제하세요.';return false;}s.pending.push(clip);}return true;}
async function stop(s,id){const a=s.active[id];if(!a)return;complete(s,a);delete s.active[id];await chrome.tabs.sendMessage(Number(id),{type:'stop'}).catch(()=>{});await chrome.action.setBadgeText({tabId:Number(id),text:''}).catch(()=>{});}
async function upload(s,ids,team){
 if(!team)throw Error('먼저 로그인하세요.');
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'))throw Error('전송할 기록을 선택하세요.');
 const selected=new Set(ids);const items=s.pending.filter(r=>selected.has(r.session.id)&&same(r.session.team,team));
 if(items.length!==selected.size)throw Error('선택한 기록을 찾을 수 없습니다. 목록을 새로고침하세요.');
 let failed=0,completed=0;
 const progress=phase=>notify({type:'upload-progress',team,total:items.length,completed,failed,phase});
 progress('preparing');
 try{for(const item of items){try{await uploadRecording(client,item,team,progress);s.pending=s.pending.filter(r=>r.session.id!==item.session.id);s.sent++;await storage(s);}catch(e){failed++;s.error=`전송 실패: ${e.message}. 실패한 기록은 보관됩니다.`;await storage(s);}finally{completed++;progress('next');}}
 if(!failed){s.error='';await storage(s);}
 return {sent:items.length-failed,failed};
 }finally{progress('finished');notify({type:'recordings-changed'});}
}
async function handle(msg,sender){await ready;const s=await storage();const trusted=!sender.tab&&sender.url===chrome.runtime.getURL('popup.html');
if(trusted){
 if(msg.type==='login'){for(const id of Object.keys(s.active))await stop(s,id);await storage(s);const {error}=await client.auth.signInWithPassword({email:`${String(msg.nickname).trim().toLowerCase()}.${String(msg.project).trim().toLowerCase()}@${config.emailDomain}`,password:msg.password});if(error)throw Error('프로젝트 코드, 닉네임, 비밀번호를 확인하세요.');await member();return {ok:true};}
 if(msg.type==='logout'){for(const id of Object.keys(s.active))await stop(s,id);await storage(s);await client.auth.signOut({scope:'local'});return {ok:true};}
 if(msg.type==='status'){const team=await member();return {team,active:Object.keys(s.active).map(Number),captures:Object.values(s.active).filter(a=>a.clip&&same(a.team,team)).map(a=>({id:a.clip.session.id,startedAt:a.clip.session.trigger.at,endAt:a.clip.session.captureEndAt})),records:s.pending.filter(r=>same(r.session.team,team)).map(r=>({id:r.session.id,startedAt:r.session.startedAt,url:r.session.url,trigger:r.session.trigger})),sent:s.sent,uploadError:s.error};}
 if(msg.type==='capture'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab||tab.id!==msg.tabId)throw Error('활성 탭이 변경되었습니다. 다시 시도하세요.');await captureTab(tab);return {ok:true};}
 if(msg.type==='notes'){setRecordingNotes(s.pending,msg.id,msg.notes,await member());await storage(s);return {ok:true};}
 if(msg.type==='preview'){const team=await member();if(!team)throw Error('먼저 로그인하세요.');const record=s.pending.find(r=>r.session.id===msg.id&&same(r.session.team,team));if(!record)throw Error('기록을 찾을 수 없습니다.');return {record};}
 if(msg.type==='send'){return upload(s,msg.ids,await member());}
 if(msg.type==='delete'){const team=await member();if(!team)throw Error('먼저 로그인하세요.');if(!Array.isArray(msg.ids)||!msg.ids.length)throw Error('삭제할 기록을 선택하세요.');const ids=new Set(msg.ids);s.pending=s.pending.filter(r=>!ids.has(r.session.id)||!same(r.session.team,team));await storage(s);return {ok:true};}
 if(msg.type==='stop'){await stop(s,msg.tabId);await storage(s);return {ok:true};}
 if(msg.type==='start'){const team=await member();if(!team)throw Error('먼저 로그인하세요.');if(s.pending.length>=20)throw Error('로컬 기록을 전송하거나 삭제하세요.');const tab=await chrome.tabs.get(msg.tabId);const url=new URL(tab.url);if(!['https:','http:'].includes(url.protocol))throw Error('일반 웹사이트에서 시작하세요.');const origin=url.origin;const match=`${origin}/*`;if(!await chrome.permissions.contains({origins:[match]}))throw Error('사이트 접근 권한이 필요합니다.');
 const registrations=await chrome.scripting.getRegisteredContentScripts();const id='site-'+new TextEncoder().encode(origin).reduce((a,b)=>a+b.toString(16),'');if(!registrations.some(r=>r.id===id+'-content'))await chrome.scripting.registerContentScripts([{id:id+'-hook',matches:[match],js:['hook.js'],runAt:'document_start',world:'MAIN',persistAcrossSessions:false},{id:id+'-content',matches:[match],js:['content.js'],runAt:'document_start',persistAcrossSessions:false}]);
 await stop(s,msg.tabId);s.active[msg.tabId]={id:crypto.randomUUID(),origin,team,documents:{},logs:[]};await storage(s);await chrome.scripting.executeScript({target:{tabId:msg.tabId},files:['hook.js'],world:'MAIN'});await chrome.scripting.executeScript({target:{tabId:msg.tabId},files:['content.js']});await chrome.tabs.sendMessage(msg.tabId,{type:'start'});await chrome.action.setBadgeText({tabId:msg.tabId,text:'REC'});await chrome.action.setBadgeBackgroundColor({tabId:msg.tabId,color:'#db4545'});return {ok:true};}
 throw Error('지원하지 않는 요청입니다.');
}
const id=sender.tab?.id,a=s.active[id];if(!a||sender.frameId!==0||new URL(sender.url).origin!==a.origin)return {};
// Browser-supplied tab, origin and a per-recording ID bind telemetry to the selected session.
if(msg.type==='hello'){const session=(await client.auth.getSession()).data.session;if(!session||session.user.id!==a.team.userId){await stop(s,id);await storage(s);return {};}return {sessionId:a.id};}
if(msg.sessionId!==a.id)return {};
if(a.clip&&Date.now()>=a.clip.session.captureEndAt){if(!complete(s,a)){await stop(s,id);await storage(s);return {};}}
if(msg.type==='batch')addBatch(a,msg.batch);
if(msg.type==='log')addLog(a,msg.event,a.team);
if(a.clip&&bytes(a.clip)>8_000_000)complete(s,a);
await storage(s);return {};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{serial(()=>handle(msg,sender)).then(respond,e=>respond({error:e.message}));return true;});
chrome.tabs.onRemoved.addListener(id=>void serial(async()=>{const s=await storage();await stop(s,id);await storage(s);}));
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url)void serial(async()=>{const s=await storage(),a=s.active[id];if(a&&new URL(change.url).origin!==a.origin){await stop(s,id);await storage(s);}});});
chrome.runtime.onStartup.addListener(()=>void serial(async()=>{const s=await storage();for(const id of Object.keys(s.active))await stop(s,id);await storage(s);}));
chrome.alarms.create('upload',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>void serial(async()=>{const s=await storage();for(const a of Object.values(s.active))if(a.clip&&Date.now()>=a.clip.session.captureEndAt)complete(s,a);await storage(s);}));

chrome.permissions.onRemoved.addListener(()=>void serial(async()=>{const s=await storage();for(const [id,a] of Object.entries(s.active))if(!await chrome.permissions.contains({origins:[`${a.origin}/*`]}))await stop(s,id);await storage(s);}));
