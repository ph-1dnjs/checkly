import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {addLog,addBatch,finish,uploadRecording} from '../src/core.js';

test('API request and response survive capture and server upload without masking',async()=>{
 const team={projectId:'project',userId:'user'};const state={id:'session',documents:{},logs:[]};
 addBatch(state,{documentId:'page',url:'https://example.com',events:[{type:2,timestamp:1000,data:{}}]},1000);
 const payload={request:{state:'captured',text:'{"email":"person@example.com"}'},response:{state:'captured',text:'{"error":"실패"}'},responseContentType:'application/json'};
 addLog(state,{type:'fetch',status:401,method:'POST',url:'https://example.com/api',pageUrl:'https://example.com',payload},team,1000);
 const recording=finish(state,2000);assert.deepEqual(recording.logs[0].payload,payload);
 let uploaded;const client={storage:{from:()=>({upload:async(_p,buffer)=>{uploaded=JSON.parse(gunzipSync(Buffer.from(buffer)));return {};}})},from:()=>({upsert:async()=>({})})};
 await uploadRecording(client,recording,team);assert.deepEqual(uploaded.logs[0].payload,payload);
});
