(()=>{
if(window.__checklyHookInstalled)return;window.__checklyHookInstalled=true;let enabled=false;
window.addEventListener('__checkly_control',e=>{enabled=e.detail===true;});
const clean=v=>{try{const u=new URL(String(v),location.href);u.search='';u.hash='';u.username='';u.password='';return u.href;}catch{return '';}};
const emit=(type,url,status,method,payload)=>{if(enabled)window.postMessage({checklyTelemetry:true,type,url:clean(url||location.href),pageUrl:clean(location.href),status,method,payload},location.origin);};
const limit=64*1024;
const unavailable=note=>({state:'unavailable',note});
async function readStream(stream){
 if(!stream)return {state:'empty'};
 const reader=stream.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){void reader.cancel().catch(()=>{});return {state:'omitted',note:'본문이 64KB를 초과해 저장하지 않았습니다.'};}chunks.push(value);}}
 catch{return unavailable('본문을 읽을 수 없습니다.');}
 const merged=new Uint8Array(size);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.length;}
 return size?{state:'captured',text:new TextDecoder().decode(merged)}:{state:'empty'};
}
function fromValue(value){
 if(value==null)return {state:'empty'};
 if(typeof value==='string'||value instanceof URLSearchParams){const text=String(value);return new TextEncoder().encode(text).length<=limit?(text?{state:'captured',text}:{state:'empty'}):{state:'omitted',note:'본문이 64KB를 초과해 저장하지 않았습니다.'};}
 return {state:'omitted',note:'파일 또는 스트림 요청 본문은 저장하지 않습니다.'};
}
window.addEventListener('error',e=>emit(e.target!==window?'resource-error':'page-error'),true);
window.addEventListener('unhandledrejection',()=>emit('unhandled-rejection'));
const original=console.error;console.error=function(...args){emit('console-error');return Reflect.apply(original,this,args);};
const fetchOriginal=window.fetch;window.fetch=function(...args){
 if(!enabled)return Reflect.apply(fetchOriginal,this,args);
 const method=args[1]?.method||args[0]?.method||'GET';let request;
 try{request=args[1]&&'body'in args[1]?Promise.resolve(fromValue(args[1].body)):args[0] instanceof Request?readStream(args[0].clone().body):Promise.resolve({state:'empty'});}catch{request=Promise.resolve(unavailable('요청 본문을 읽을 수 없습니다.'));}
 return Reflect.apply(fetchOriginal,this,args).then(response=>{
  let responseBody;try{responseBody=readStream(response.clone().body);}catch{responseBody=Promise.resolve(unavailable('응답 본문을 읽을 수 없습니다.'));}
  void Promise.all([request,responseBody]).then(([req,res])=>emit('fetch',response.url,response.status,method,{request:req,response:res,responseContentType:response.headers.get('content-type')||undefined}));return response;
 },error=>{void request.then(req=>emit('fetch',args[0]?.url||args[0],0,method,{request:req,response:unavailable('요청에 실패해 응답을 받지 못했습니다.')}));throw error;});
};
const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;const info=new WeakMap();
XMLHttpRequest.prototype.open=function(method,url,...rest){info.set(this,{method,url});return Reflect.apply(open,this,[method,url,...rest]);};
XMLHttpRequest.prototype.send=function(...args){if(!enabled)return Reflect.apply(send,this,args);const item=info.get(this);const request=fromValue(args[0]);this.addEventListener('loadend',()=>{let response;try{response=this.responseType===''||this.responseType==='text'?fromValue(this.responseText):this.responseType==='json'?fromValue(JSON.stringify(this.response)):unavailable('텍스트가 아닌 응답은 저장하지 않습니다.');}catch{response=unavailable('응답 본문을 읽을 수 없습니다.');}emit('xhr',this.responseURL||item?.url,this.status,item?.method,{request,response,responseContentType:this.getResponseHeader('content-type')||undefined});},{once:true});return Reflect.apply(send,this,args);};
for(const name of ['pushState','replaceState']){const native=history[name];history[name]=function(...args){const result=Reflect.apply(native,this,args);emit('navigation');return result;};}
window.addEventListener('popstate',()=>emit('navigation'));
})();
