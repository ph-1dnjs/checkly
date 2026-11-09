import {captureProgress} from './recording-status.js';
import {replayEvents} from './replay.js';
import {previewIcon,pauseIcon} from './icons.js';
import {Replayer} from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
const $=id=>document.getElementById(id);let tab;
let consentAccepted=false;
let currentTeam=null,captures=[],knownRecordIds=null,recordsKey='',uploadBusy=false,refreshVersion=0,autoRefreshTimer;
function renderCaptureProgress(){const progress=captureProgress(captures);$('capture-progress').hidden=!progress;if(progress){$('capture-progress-label').textContent=progress.label;if(progress.percent<100)$('capture-progress-bar').value=progress.percent;else $('capture-progress-bar').removeAttribute('value');}}
setInterval(renderCaptureProgress,250);
function renderUploadProgress(info){
  uploadBusy=info.phase!=='finished';
  const phases={preparing:'전송 준비 중',uploading:'파일 업로드 중',saving:'서버 기록 저장 중',next:'다음 기록 전송 중'};
  const label=uploadBusy?`${phases[info.phase]||'전송 중'} · ${info.completed}/${info.total}건 완료`:`서버 전송 완료 ${info.completed-info.failed}건${info.failed?` · 실패 ${info.failed}건 (로컬 보관)`:''}`;
  for(const name of ['upload-progress','sheet-upload-progress']){const box=$(name);box.hidden=false;$(name+'-label').textContent=label;const bar=box.querySelector('progress');if(uploadBusy)bar.removeAttribute('value');else {bar.max=1;bar.value=1;}}
  updateSelection();
}
async function sendRecords(ids){
  if(uploadBusy)throw Error('기록 전송이 진행 중입니다.');
  renderUploadProgress({phase:'preparing',total:ids.length,completed:0,failed:0});
  try{const result=await call({type:'send',ids});renderUploadProgress({phase:'finished',total:ids.length,completed:ids.length,failed:result.failed});return result;}
  catch(error){renderUploadProgress({phase:'finished',total:ids.length,completed:ids.length,failed:ids.length});throw error;}
}
function updateRecordingStatus(status){
  const sameAccount=currentTeam?.userId===status.team?.userId&&currentTeam?.projectId===status.team?.projectId;
  if(!sameAccount||!status.team){knownRecordIds=null;recordsKey='';$('local-save-status').textContent='';uploadBusy=false;for(const id of ['upload-progress','sheet-upload-progress'])$(id).hidden=true;}
  currentTeam=status.team;captures=status.captures||[];renderCaptureProgress();
  if(status.team){const ids=new Set(status.records.map(r=>r.id));if(knownRecordIds){const added=[...ids].filter(id=>!knownRecordIds.has(id)).length;if(added)$('local-save-status').textContent=`새 기록 ${added}건이 로컬에 저장되었습니다.`;}knownRecordIds=ids;}
}
function scheduleRefresh(){clearTimeout(autoRefreshTimer);autoRefreshTimer=setTimeout(()=>void refresh(true).catch(error=>{$('local-save-status').textContent=`목록 자동 갱신 실패: ${error.message}`;}),100);}
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return;
  if(message.type==='recordings-changed'){if(currentTeam&&Array.isArray(message.captures)){const incoming=message.captures.filter(c=>c.team?.userId===currentTeam.userId&&c.team?.projectId===currentTeam.projectId);if(incoming.length){captures=incoming;$('local-save-status').textContent='';renderCaptureProgress();}}scheduleRefresh();}
  if(message.type==='upload-progress'&&currentTeam&&message.team.userId===currentTeam.userId&&message.team.projectId===currentTeam.projectId)renderUploadProgress(message);
  if(message.type==='recording-storage-error'){captures=[];renderCaptureProgress();$('local-save-status').textContent='로컬 기록을 저장하지 못했습니다. 저장 공간을 확인해 주세요.';}
});
const consentReady=chrome.storage.local.get('recordingConsentV1').then(value=>{consentAccepted=value.recordingConsentV1===true;renderConsent();});
function renderConsent(){$('consent').checked=consentAccepted;$('consent-box').hidden=consentAccepted;}
$('consent').onchange=async()=>{const accepted=$('consent').checked;try{await chrome.storage.local.set({recordingConsentV1:accepted});consentAccepted=accepted;renderConsent();}catch(e){$('consent').checked=consentAccepted;$('message').textContent=`동의를 저장하지 못했습니다: ${e.message}`;}};
function setPlayback(playing){$('preview-play').innerHTML=playing?pauseIcon:previewIcon;const label=playing?'일시정지':'재생';$('preview-play').setAttribute('aria-label',label);$('preview-play').title=label;}
setPlayback(false);
function closeMenu(){$('account-menu').hidden=true;$('more').setAttribute('aria-expanded','false');}
$('more').setAttribute('aria-expanded','false');$('more').setAttribute('aria-controls','account-menu');
$('more').onclick=()=>{const open=$('account-menu').hidden;$('account-menu').hidden=!open;$('more').setAttribute('aria-expanded',String(open));if(open)$('logout').focus();};
document.addEventListener('click',e=>{if(!e.target.closest('.menu-anchor'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('account-menu').hidden){closeMenu();$('more').focus();}});

async function call(data){const r=await chrome.runtime.sendMessage(data);if(r?.error)throw Error(r.error);return r;}
async function refresh(silent=false){const version=++refreshVersion;await consentReady;const [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});const s=await call({type:'status'});if(version!==refreshVersion)return;tab=activeTab;updateRecordingStatus(s);$('login').hidden=!!s.team;$('controls').hidden=!s.team;$('account-actions').hidden=!s.team;$('status-light').hidden=!s.team;if(s.team){$('account').textContent=s.team.nickname;$('avatar').textContent=s.team.nickname.slice(0,1).toUpperCase();const active=s.active.includes(tab?.id);$('status-light').setAttribute('aria-label',active?'모니터링 중':'모니터링 대기');$('status-light').title=active?'모니터링 중':'모니터링 대기';$('start').disabled=active;$('stop').disabled=!active;$('start').hidden=active;$('stop').hidden=!active;$('status-light').classList.toggle('active',active);$('counts').textContent=`화면 기록 ${s.records.length} · 전송 완료 ${s.sent}`;renderRecords(s.records);}else{$('account').textContent='Checkly';$('avatar').textContent='C';closeMenu();void closePreview(false);$('records').replaceChildren();recordsKey='';}if(s.team&&s.uploadError)$('message').textContent=s.uploadError;else if(!silent)$('message').textContent='';}
async function run(fn){try{$('message').textContent='처리 중…';await fn();await refresh();}catch(e){const message=e.message;try{await refresh();}catch{}$('message').textContent=message;}}
$('login').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const data=Object.fromEntries(f);e.target.elements.password.value='';void run(()=>call({type:'login',...data}));};
$('capture').onclick=()=>void (async()=>{try{if(!tab?.id)throw Error('캡처할 탭을 선택하세요.');try{await call({type:'capture',tabId:tab.id});}catch(error){if(!/permission|activeTab|access/i.test(error.message))throw error;const granted=await chrome.permissions.request({origins:['<all_urls>']});if(!granted)throw Error('캡처 권한이 필요합니다. 단축키를 사용해도 캡처할 수 있습니다.');await call({type:'capture',tabId:tab.id});}}catch(e){$('message').textContent=`화면 캡처 실패: ${e.message}`;}})();
$('start').onclick=()=>{if(!tab?.url){$('message').textContent='웹사이트 탭을 선택하세요.';return;}if(!consentAccepted){$('message').textContent='수집·전송 안내를 확인하고 동의해 주세요.';return;}const url=new URL(tab.url);if(!['http:','https:'].includes(url.protocol)){$('message').textContent='일반 웹사이트 탭에서 시작하세요.';return;}void run(async()=>{const granted=await chrome.permissions.request({origins:[`${url.origin}/*`]});if(!granted)throw Error('사이트 접근 권한이 필요합니다.');await call({type:'start',tabId:tab.id});});};
for(const type of ['stop','logout'])$(type).onclick=()=>{closeMenu();void run(async()=>{if(type==='logout')await closePreview();await call({type,tabId:tab?.id});});};
function updateSelection(){const count=selected().length;$('send').disabled=!count||uploadBusy;$('delete').disabled=!count||uploadBusy;$('send').title=`선택한 기록 전송 (${count})`;$('delete').title=`선택한 기록 삭제 (${count})`;}
function renderRecords(records){const key=JSON.stringify(records);if(key===recordsKey){updateSelection();return;}recordsKey=key;const checked=new Set(selected());const list=$('records');list.replaceChildren();for(const record of [...records].reverse()){const row=document.createElement('div');row.className='record';const label=document.createElement('label');label.className='record-select';const input=document.createElement('input');input.type='checkbox';input.value=record.id;input.checked=checked.has(record.id);input.setAttribute('aria-label',`${new Date(record.startedAt).toLocaleString()} 기록 선택`);input.onchange=updateSelection;const details=document.createElement('span');const title=document.createElement('strong');title.textContent=`${new Date(record.startedAt).toLocaleString()} · ${record.trigger?.type||'오류'}`;const url=document.createElement('small');url.textContent=record.url||'주소 없음';url.title=record.url||'';details.append(title,url);label.append(input,details);const preview=document.createElement('button');preview.type='button';preview.className='icon-button';preview.innerHTML=previewIcon;preview.setAttribute('aria-label','기록 미리보기');preview.title='기록 미리보기';preview.onclick=()=>void openPreview(record.id);row.append(label,preview);list.append(row);}if(!records.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='보관 중인 기록이 없습니다.';list.append(empty);}updateSelection();}
function selected(){return [...$('records').querySelectorAll('input:checked')].map(input=>input.value);}
$('send').onclick=()=>void run(async()=>{const ids=selected();if(!ids.length)throw Error('전송할 기록을 선택하세요.');await saveNotes();const result=await sendRecords(ids);if(result.failed)throw Error(`${result.sent}건 전송, ${result.failed}건 실패. 실패한 기록은 보관됩니다.`);});
$('delete').onclick=()=>void run(async()=>{const ids=selected();if(!ids.length)throw Error('삭제할 기록을 선택하세요.');if(confirm(`선택한 화면 기록 ${ids.length}건을 삭제할까요?`))await call({type:'delete',ids});});
let player,recording,resizeObserver,noteTimer,previousFocus;
let previewSending=false;
let previewVersion=0,noteChain=Promise.resolve(),position=0,initialPosition=0,finished=false;
function reportNoteError(error){$('notes-status').textContent=`저장 실패: ${error.message}. 다시 닫기를 눌러 재시도하세요.`;}
function saveNotes(){
  clearTimeout(noteTimer);
  if(!recording)return noteChain;
  const target=recording,notes=$('record-notes').value;
  noteChain=noteChain.catch(()=>{}).then(async()=>{
    if(notes===(target.session.notes||''))return;
    $('notes-status').textContent='저장 중…';
    await call({type:'notes',id:target.session.id,notes});
    target.session.notes=notes;
    if(recording===target&&$('record-notes').value===notes)$('notes-status').textContent='저장됨 · 기록 전송 시 함께 업로드됩니다.';
  });
  return noteChain;
}
$('record-notes').oninput=()=>{clearTimeout(noteTimer);$('notes-status').textContent='저장 대기 중…';noteTimer=setTimeout(()=>void saveNotes().catch(reportNoteError),300);};
async function openPreview(id){
  try{
    if(recording)await closePreview();
    const version=++previewVersion;
    const result=await call({type:'preview',id});if(version!==previewVersion)return;
    recording=result.record;previousFocus=document.activeElement;
    $('record-notes').value=recording.session.notes||'';
    $('notes-status').textContent='자동 저장 · 기록 전송 시 함께 업로드됩니다.';
    $('preview-error').textContent='';$('preview-send-status').textContent='';$('sheet-upload-progress').hidden=true;$('preview').showModal();
    document.body.classList.add('sheet-open');showRecording();
  }catch(error){$('message').textContent=error.message;}
}
function showRecording(){
  player?.destroy();resizeObserver?.disconnect();player=null;$('preview-root').replaceChildren();
  const events=replayEvents(recording);
  $('preview-play').disabled=!events.some(e=>e.type===2);
  if($('preview-play').disabled){$('preview-error').textContent='재생 가능한 화면이 없습니다.';return;}
  try{
    player=new Replayer(events,{root:$('preview-root'),showWarning:false,showDebug:false,mouseTail:false,loadTimeout:1000});
    const meta=events.find(e=>e.type===4)?.data||{};
    let dimensions={width:Number(meta.width)||1280,height:Number(meta.height)||720};
    const fit=()=>{const stage=$('preview-stage');const scale=Math.min(stage.clientWidth/dimensions.width,stage.clientHeight/dimensions.height,1);Object.assign(player.wrapper.style,{width:`${dimensions.width}px`,height:`${dimensions.height}px`,transformOrigin:'top left',transform:`scale(${scale})`,marginLeft:`${Math.max(0,(stage.clientWidth-dimensions.width*scale)/2)}px`,marginTop:`${Math.max(0,(stage.clientHeight-dimensions.height*scale)/2)}px`});};
    player.on('resize',size=>{dimensions=size;fit();});resizeObserver=new ResizeObserver(fit);resizeObserver.observe($('preview-stage'));
    const first=events[0].timestamp,snapshot=events.find(e=>e.type===2).timestamp;
    initialPosition=Math.max(snapshot-first+1,(recording.session.captureStartAt||first)-first);position=initialPosition;finished=false;
    player.pause(position);fit();player.on('finish',()=>{finished=true;setPlayback(false);});setPlayback(false);
  }catch(error){$('preview-error').textContent=`미리보기를 열지 못했습니다: ${error.message}`;$('preview-play').disabled=true;}
}
$('preview-play').onclick=()=>{if(!player)return;if(player.service.state.matches('playing')){position=player.getCurrentTime();player.pause();setPlayback(false);}else{player.play(finished?initialPosition:position);finished=false;setPlayback(true);}};
async function closePreview(save=true){
  if(previewSending&&save)return;
  if(save){$('record-notes').disabled=true;try{await saveNotes();}finally{$('record-notes').disabled=false;}}
  clearTimeout(noteTimer);previewVersion++;player?.destroy();resizeObserver?.disconnect();player=null;recording=null;
  $('preview').close();document.body.classList.remove('sheet-open');$('preview-root').replaceChildren();previousFocus?.focus();
}
$('preview-send').onclick=async()=>{
  if(!recording||previewSending)return;
  const id=recording.session.id;
  previewSending=true;$('preview-send').disabled=true;$('preview-close').disabled=true;$('record-notes').disabled=true;
  $('preview-send-label').textContent='전송 중…';$('preview-send-status').textContent='';
  try{
    await saveNotes();
    const result=await sendRecords([id]);
    if(result.failed||result.sent!==1)throw Error('기록을 전송하지 못했습니다. 참고사항과 기록은 보관됩니다. 다시 시도해 주세요.');
    await closePreview(false);
    await refresh();$('message').textContent='참고사항과 기록을 서버로 전송했습니다.';
  }catch(error){
    if($('preview').open)$('preview-send-status').textContent=error.message;
    else $('message').textContent=`전송 후 목록을 갱신하지 못했습니다: ${error.message}`;
  }finally{
    previewSending=false;$('preview-send').disabled=false;$('preview-close').disabled=false;$('record-notes').disabled=false;$('preview-send-label').textContent='서버로 전송';
  }
};
$('preview-close').onclick=()=>void closePreview().catch(reportNoteError);
$('preview').addEventListener('cancel',event=>{event.preventDefault();void closePreview().catch(reportNoteError);});
$('preview').addEventListener('click',event=>{if(event.target!==$('preview'))return;const box=$('preview').getBoundingClientRect();if(event.clientY<box.top||event.clientX<box.left||event.clientX>box.right)void closePreview().catch(reportNoteError);});
chrome.tabs.onActivated.addListener(()=>void run(refresh));
chrome.tabs.onUpdated.addListener((id,change)=>{if(id===tab?.id&&(change.url||change.status==='complete'))void run(refresh);});
chrome.windows.onFocusChanged.addListener(()=>void run(refresh));
$('reload').onclick=()=>void run(refresh);
void run(refresh);
