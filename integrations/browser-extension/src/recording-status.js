export function activeCaptures(state){
  return Object.values(state.active).filter(a=>a.clip&&a.team).map(a=>({id:a.clip.session.id,startedAt:a.clip.session.trigger.at,endAt:a.clip.session.captureEndAt,team:a.team}));
}
export function recordingStatusKey(state){
  return JSON.stringify({active:Object.entries(state.active).map(([id,a])=>[id,a.clip?.session.id]),records:state.pending.map(r=>r.session.id),sent:state.sent,error:state.error});
}
export function captureProgress(captures,now=Date.now()){
  if(!captures.length)return null;
  const remaining=Math.max(...captures.map(c=>c.endAt-now));
  const percent=Math.min(...captures.map(c=>Math.max(0,Math.min(100,100*(now-c.startedAt)/Math.max(1,c.endAt-c.startedAt)))));
  return {percent,label:remaining>0?`오류 화면 수집 중 · ${captures.length}건 · ${Math.ceil(remaining/1000)}초 남음`:'로컬 기록 저장 중…'};
}
