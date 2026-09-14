import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { SpecSync } from "../../src/app/api-testing/main/spec-sync";

test("spec refresh persists encrypted credentials, rejects URL/scope changes and preserves failed snapshots", async () => {
  let status=200, hits=0;
  const basic=`Basic ${Buffer.from("docs:secret-pass").toString("base64")}`;
  const server=createServer((req,res)=>{ hits++; res.setHeader("content-type","application/json"); res.statusCode=req.headers.authorization===basic?status:401; res.end(JSON.stringify({openapi:"3.0.3",info:{title:"동기화",version:"1"},paths:{"/health":{get:{responses:{"200":{description:"OK"}}}}}})); });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const dir=await mkdtemp(path.join(tmpdir(),"checkly-sync-"));
  const key=randomBytes(32);
  const secrets={available:()=>true,encrypt:(value:string)=>{const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key,iv);const data=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString("base64");},decrypt:(value:string)=>{const data=Buffer.from(value,"base64"),cipher=createDecipheriv("aes-256-gcm",key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString("utf8");}};
  try {
    const workspace=new ApiWorkspace(dir), scope={projectId:randomUUID(),serverId:randomUUID(),environmentId:randomUUID()}, otherEnv=randomUUID();
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/openapi.json`;
    await workspace.saveProject({id:scope.projectId,name:"동기화",servers:[{id:scope.serverId,name:"API"}],environments:[scope.environmentId,otherEnv].map(id=>({id,name:id,baseUrls:{[scope.serverId]:url}}))});
    const sync=new SpecSync(dir,workspace,secrets);
    await sync.importUrl(scope,{kind:"url",url,auth:{kind:"basic",username:"docs",password:"secret-pass"},remember:true});
    const metadata=await sync.get(scope);
    assert.equal(metadata.hasSavedAccount,true); assert.equal(metadata.url,url); assert.equal(metadata.status,"success"); assert.ok(!JSON.stringify(metadata).includes("secret-pass"));
    const restarted=new SpecSync(dir,new ApiWorkspace(dir),secrets);
    await restarted.importUrl(scope,{kind:"url",url,useSavedAuth:true});
    const before=await workspace.getCatalog(scope), calls=hits;
    await assert.rejects(restarted.importUrl(scope,{kind:"url",url:url+"?other=1",useSavedAuth:true}),/주소/);
    await assert.rejects(restarted.importUrl({...scope,environmentId:otherEnv},{kind:"url",url,useSavedAuth:true}),/주소/);
    assert.equal(hits,calls);
    status=401;
    await assert.rejects(restarted.importUrl(scope,{kind:"url",url,useSavedAuth:true}),/401/);
    assert.deepEqual(await workspace.getCatalog(scope),before);
    assert.equal((await restarted.get(scope)).status,"failed"); assert.equal((await restarted.get(scope)).hasSavedAccount,true);
    for(const file of await readdir(dir)){const data=await readFile(path.join(dir,file),"utf8"); assert.ok(!data.includes("secret-pass")&&!data.includes(basic));}
    const insecure=new SpecSync(dir,workspace,{...secrets,available:()=>false});
    const oldHits=hits;
    await assert.rejects(insecure.importUrl(scope,{kind:"url",url,auth:{kind:"basic",username:"docs",password:"secret-pass"},remember:true}),/보안 저장소/);
    assert.equal(hits,oldHits);
    await restarted.deleteAccount(scope); assert.equal((await restarted.get(scope)).hasSavedAccount,false);
    await assert.rejects(restarted.importUrl(scope,{kind:"url",url,useSavedAuth:true}),/저장된 계정/);
    status=200;
    await restarted.importUrl(scope,{kind:"url",url,auth:{kind:"basic",username:"docs",password:"secret-pass"}});
    assert.equal((await restarted.get(scope)).hasSavedAccount,false);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
