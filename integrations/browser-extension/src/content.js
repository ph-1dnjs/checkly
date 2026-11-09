import {record} from '@rrweb/record';
import {cleanUrl} from './core.js';
(()=>{
if(globalThis.__checklyContent)return;globalThis.__checklyContent=true;
let stop,timer,events=[],sessionId,documentId=crypto.randomUUID();
const send=async data=>{try{return await chrome.runtime.sendMessage(data);}catch{shutdown();}};
function sanitize(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(sanitize);const out={};for(const [key,child]of Object.entries(value)){if(key==='attributes'){out[key]={};for(const [a,v]of Object.entries(child||{})){if(/^on|^data-|token|secret|password|nonce|value|srcdoc/i.test(a))continue;if(['src','href','action','poster','xlink:href'].includes(a))out[key][a]=cleanUrl(v);else if(a!=='srcset')out[key][a]=v;}}else out[key]=key==='href'?cleanUrl(child):sanitize(child);}return out;}
function flush(){if(!sessionId)return;const batch=events;events=[];for(let i=0;i<batch.length;i+=100)void send({type:'batch',sessionId,batch:{documentId,url:cleanUrl(location.href),events:batch.slice(i,i+100)}});void send({type:'tick',sessionId});}
function shutdown(){stop?.();stop=null;clearInterval(timer);events=[];sessionId=null;window.dispatchEvent(new CustomEvent('__checkly_control',{detail:false}));}
async function start(){const result=await send({type:'hello'});if(!result?.sessionId||sessionId)return;sessionId=result.sessionId;window.dispatchEvent(new CustomEvent('__checkly_control',{detail:true}));stop=record({maskAllInputs:true,maskTextSelector:'*',blockSelector:'[data-checkly-block],iframe,canvas,video,audio',recordCanvas:false,inlineImages:false,collectFonts:false,slimDOMOptions:true,checkoutEveryNms:5000,sampling:{mousemove:100,scroll:150},emit:e=>{events.push(sanitize(e));if(events.length>=100)flush();}});timer=setInterval(flush,500);void send({type:'log',sessionId,event:{type:'navigation',url:cleanUrl(location.href),pageUrl:cleanUrl(location.href)}});}
window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin||!sessionId||e.data?.checklyTelemetry!==true)return;flush();void send({type:'log',sessionId,event:{type:e.data.type,url:cleanUrl(e.data.url),pageUrl:cleanUrl(location.href),status:e.data.status,method:e.data.method}});});
chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='stop')shutdown();if(msg.type==='start')void start();});
window.addEventListener('pagehide',()=>{flush();shutdown();});window.addEventListener('pageshow',()=>void start());void start();
})();
