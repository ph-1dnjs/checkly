export const cleanUrl=value=>{try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))return '';u.search='';u.hash='';u.username='';u.password='';return u.href;}catch{return '';}};
export const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export function addBatch(state,batch,now=Date.now()){
  if(!batch||typeof batch.documentId!=='string'||batch.documentId.length>100||!Array.isArray(batch.events)||batch.events.length>100||bytes(batch)>2_000_000)return;
  const events=batch.events.filter(e=>e&&Number.isInteger(e.type)&&Number.isFinite(e.timestamp)&&Math.abs(e.timestamp-now)<60_000);
  const doc=state.documents[batch.documentId]??={id:batch.documentId,url:cleanUrl(batch.url),title:'테스트 페이지',events:[]};
  doc.events.push(...events);
  if(state.clip){const target=state.clip.documents.find(d=>d.id===doc.id);const next=events.filter(e=>e.timestamp<=state.clip.session.captureEndAt);if(target)target.events.push(...next);else if(next.some(e=>e.type===2))state.clip.documents.push({...doc,events:[...doc.events]});}
  let anchor=-1;doc.events.forEach((e,i)=>{if(e.type===2&&e.timestamp<=now-5000)anchor=i;});
  if(anchor>0){const meta=doc.events.findLast(e=>e.type===4);doc.events=meta?[{...meta,timestamp:doc.events[anchor].timestamp},...doc.events.slice(anchor)]:doc.events.slice(anchor);}
  for(const [id,d] of Object.entries(state.documents))if(d.events.at(-1)?.timestamp<now-15000)delete state.documents[id];
  if(bytes(state.documents)>6_000_000)state.documents={};
}
export function addLog(state,event,team,now=Date.now()){
  const kinds=['fetch','xhr','navigation','page-error','resource-error','unhandled-rejection','console-error'];
  if(!event||!kinds.includes(event.type))return;
  const status=Number.isInteger(event.status)&&event.status>=0&&event.status<=599?event.status:null;
  const log={id:crypto.randomUUID(),browser_session_id:state.id,source:'browser',kind:event.type,occurred_at:new Date(now).toISOString(),url:cleanUrl(event.url),page_url:cleanUrl(event.pageUrl),method:typeof event.method==='string'&&/^[A-Z]{1,16}$/.test(event.method)?event.method:null,status,duration_ms:null,is_error:event.type.endsWith('error')||event.type==='unhandled-rejection'||status===0||status>=400};
  if(['fetch','xhr'].includes(event.type)&&event.payload&&bytes(event.payload)<=140_000){
    const body=value=>value&&['captured','empty','unavailable','omitted'].includes(value.state)&&(!value.text||typeof value.text==='string'&&bytes(value.text)<=70_000)?value:{state:'unavailable',note:'본문을 읽을 수 없습니다.'};
    log.payload={request:body(event.payload.request),response:body(event.payload.response),responseContentType:typeof event.payload.responseContentType==='string'?event.payload.responseContentType.slice(0,200):undefined};
  }
  state.logs=[...state.logs.filter(l=>Date.parse(l.occurred_at)>=now-5000),log].slice(-200);
  if(state.clip){state.clip.logs.push(log);return;}
  if(!log.is_error)return;
  state.clip={session:{id:crypto.randomUUID(),title:'Chrome · 오류 기록',url:log.page_url||log.url,source:'browser',startedAt:now,status:'recording',eventCount:0,bytes:0,team:{projectId:team.projectId,userId:team.userId},browserSessionId:state.id,trigger:{type:log.kind,at:now,url:log.url,status:status??undefined,logId:log.id},captureStartAt:now-5000,captureEndAt:now+5000},documents:structuredClone(Object.values(state.documents)),logs:[...state.logs]};
}
export function finish(state,now=Date.now()){
  const clip=state.clip;if(!clip)return null;
  clip.session.endedAt=Math.min(now,clip.session.captureEndAt);clip.session.captureEndAt=clip.session.endedAt;clip.session.status='saved';
  clip.documents=clip.documents.filter(d=>d.events.some(e=>e.type===2));
  for(const d of clip.documents)d.events.push({type:5,timestamp:clip.session.endedAt,data:{tag:'clip-end',payload:{}}});
  clip.session.eventCount=clip.documents.reduce((n,d)=>n+d.events.length,0);clip.session.bytes=bytes(clip);delete state.clip;return clip;
}
export async function uploadRecording(client,recording,team,onProgress=()=>{}){
  const s=recording.session;
  if(s.team.userId!==team.userId||s.team.projectId!==team.projectId)throw Error('다른 계정의 기록입니다.');
  if(bytes(recording)>50*1024*1024)throw Error('기록 크기 한도를 초과했습니다.');
  onProgress('preparing');
  const compressed=await new Response(new Blob([JSON.stringify(recording)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const body=await compressed.arrayBuffer();
  const path=`${team.projectId}/${team.userId}/${s.id}.json.gz`;
  onProgress('uploading');
  const uploaded=await client.storage.from('browser-error-replays').upload(path,body,{contentType:'application/gzip',upsert:true});if(uploaded.error)throw uploaded.error;
  onProgress('saving');
  const saved=await client.from('form_browser_recordings').upsert({id:s.id,project_id:team.projectId,created_by:team.userId,browser_session_id:s.browserSessionId,trigger_log_id:s.trigger?.logId??null,started_at:new Date(s.startedAt).toISOString(),object_path:path,metadata:s},{onConflict:'id'});if(saved.error)throw saved.error;
}

export function setRecordingNotes(records,id,notes,team){
  if(!team)throw Error('먼저 로그인하세요.');
  if(typeof notes!=='string'||notes.length>5000)throw Error('참고사항은 5,000자 이내로 입력하세요.');
  const record=records.find(r=>r.session.id===id&&r.session.team?.userId===team.userId&&r.session.team?.projectId===team.projectId);
  if(!record)throw Error('기록을 찾을 수 없습니다.');
  record.session.notes=notes;
  return record;
}
