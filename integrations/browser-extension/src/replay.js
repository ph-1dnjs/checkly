// Resource hints do not contribute to the recorded appearance and must not
// execute again inside the extension replay iframe (including old recordings).
const resourceHint = rel => typeof rel==='string' && rel.split(/\s+/).some(token=>['preload','modulepreload','prefetch','preconnect','dns-prefetch'].includes(token.toLowerCase()));
function inertResourceHints(value){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(inertResourceHints);
  const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,inertResourceHints(item)]));
  if(result.attributes&&resourceHint(result.attributes.rel)){
    result.attributes.rel='checkly-inert';
    if(String(result.tagName||'').toLowerCase()==='link')delete result.attributes.href;
  }
  return result;
}
// Each navigation has its own full snapshot. Do not replay a previous
// document's trailing events after the next document has started.
export function replayEvents(recording){
  const documents=recording.documents.filter(doc=>doc.events.some(event=>event.type===2))
    .map(doc=>[...doc.events].sort((a,b)=>a.timestamp-b.timestamp))
    .sort((a,b)=>a[0].timestamp-b[0].timestamp);
  return documents.flatMap((events,index)=>events.filter(event=>event.timestamp<(documents[index+1]?.[0].timestamp??Infinity))).map(inertResourceHints);
}
