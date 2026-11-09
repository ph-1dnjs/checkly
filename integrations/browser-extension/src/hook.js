(()=>{
if(window.__checklyHookInstalled)return;window.__checklyHookInstalled=true;let enabled=false;
window.addEventListener('__checkly_control',e=>{enabled=e.detail===true;});
const clean=v=>{try{const u=new URL(String(v),location.href);u.search='';u.hash='';u.username='';u.password='';return u.href;}catch{return '';}};
const emit=(type,url,status,method)=>{if(enabled)window.postMessage({checklyTelemetry:true,type,url:clean(url||location.href),pageUrl:clean(location.href),status,method},location.origin);};
window.addEventListener('error',e=>emit(e.target!==window?'resource-error':'page-error'),true);
window.addEventListener('unhandledrejection',()=>emit('unhandled-rejection'));
const original=console.error;console.error=function(...args){emit('console-error');return Reflect.apply(original,this,args);};
const fetchOriginal=window.fetch;window.fetch=async function(...args){try{const r=await Reflect.apply(fetchOriginal,this,args);emit('fetch',r.url,r.status,args[1]?.method||args[0]?.method||'GET');return r;}catch(e){emit('fetch',args[0]?.url||args[0],0,args[1]?.method||'GET');throw e;}};
const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;const info=new WeakMap();
XMLHttpRequest.prototype.open=function(method,url,...rest){info.set(this,{method,url});return Reflect.apply(open,this,[method,url,...rest]);};
XMLHttpRequest.prototype.send=function(...args){const item=info.get(this);this.addEventListener('loadend',()=>emit('xhr',this.responseURL||item?.url,this.status,item?.method),{once:true});return Reflect.apply(send,this,args);};
for(const name of ['pushState','replaceState']){const native=history[name];history[name]=function(...args){const result=Reflect.apply(native,this,args);emit('navigation');return result;};}
window.addEventListener('popstate',()=>emit('navigation'));
})();
