import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

test("request auth resolves latest variable and isolates server/environment/project without persisting secrets", async () => {
  const received: Array<string | undefined> = [];
  const server = createServer((req, res) => { received.push(req.headers.authorization); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ echo: req.headers.authorization })); });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-auth-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const projectId=randomUUID(), serverId=randomUUID(), secondServer=randomUUID(), environmentId=randomUUID(), secondEnv=randomUUID();
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const baseUrls={ [serverId]:url, [secondServer]:url };
    const project={id:projectId,name:"인증",servers:[{id:serverId,name:"회원"},{id:secondServer,name:"주문"}],environments:[{id:environmentId,name:"dev",baseUrls},{id:secondEnv,name:"stg",baseUrls}]};
    await workspace.saveProject(project);
    const scope={projectId,serverId,environmentId};
    const spec=JSON.stringify({openapi:"3.0.3",info:{title:"인증",version:"1"},paths:{"/check":{get:{responses:{"200":{description:"성공"}}}}}});
    const otherProject={...project,id:randomUUID()};
    await workspace.saveProject(otherProject);
    const scopes=[scope,{...scope,serverId:secondServer},{...scope,environmentId:secondEnv},{...scope,projectId:otherProject.id}];
    for (const s of scopes) await workspace.importSpec(s,spec);
    await workspace.setGlobal(scope,"accessToken","first-token");
    await workspace.setRequestAuth(scope,"accessToken");
    assert.equal(await workspace.getRequestAuth(scope),"accessToken");
    const response=await workspace.execute(scope,"GET /check",{headers:{authorization:""}});
    assert.equal(received.at(-1),"Bearer first-token");
    assert.ok(!JSON.stringify(response).includes("first-token"));
    const live = await workspace.executeLive(scope, "GET /check", {});
    assert.deepEqual(live.body, { echo: "Bearer first-token" });
    assert.equal(live.httpStatus, 200);
    // Live viewing must not change the protected response contract.
    assert.ok(!JSON.stringify(await workspace.execute(scope, "GET /check", {})).includes("first-token"));
    await workspace.setGlobal(scope,"accessToken","next-token");
    await workspace.execute(scope,"GET /check",{});
    assert.equal(received.at(-1),"Bearer next-token");
    for (const s of scopes.slice(1)) { assert.equal(await workspace.getRequestAuth(s),null); await workspace.execute(s,"GET /check",{}); assert.equal(received.at(-1),undefined); }
    let count=received.length;
    await assert.rejects(workspace.execute(scope,"GET /check",{headers:{AUTHORIZATION:"Bearer manual"}}),/중복/);
    await workspace.deleteGlobal(scope,"accessToken");
    await assert.rejects(workspace.execute(scope,"GET /check",{}),/토큰/);
    await workspace.setGlobal(scope,"accessToken",123);
    await assert.rejects(workspace.execute(scope,"GET /check",{}),/토큰/);
    assert.equal(received.length,count);
    await workspace.setGlobal(scope,"accessToken","next-token");
    await workspace.saveProject({...project,environments:project.environments.map(e=>e.id===environmentId?{...e,baseUrls:{...e.baseUrls,[serverId]:url+"/changed"}}:e)});
    await assert.rejects(workspace.execute(scope,"GET /check",{}),/주소가 변경/);
    assert.equal(received.length,count);
    await workspace.setRequestAuth(scope,null);
    assert.equal(await workspace.getRequestAuth(scope),null);
    assert.equal(await new ApiWorkspace(dir).getRequestAuth(scope),null);
    for (const file of await readdir(dir)) { const data=await readFile(path.join(dir,file),"utf8"); assert.ok(!data.includes("first-token") && !data.includes("next-token")); }
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); await rm(dir,{recursive:true,force:true}); }
});
