import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { specSourceSchema } from "../../src/app/api-testing/shared/workspace";

test("drafts preserve incomplete scenarios but cannot bypass catalog or environment validation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-draft-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const projectId = randomUUID(), serverId = randomUUID(), local = randomUUID(), dev = randomUUID();
    await workspace.saveProject({id:projectId,name:"초안",servers:[{id:serverId,name:"API"}],environments:[{id:local,name:"local",baseUrls:{[serverId]:"http://127.0.0.1:1"}},{id:dev,name:"dev",baseUrls:{[serverId]:"http://127.0.0.1:1"}}]});
    const scope = {projectId,serverId,environmentId:local};
    const source = 'version: 1\nid: local-login\nname: 로컬 전용\nenvironments: [local]\nsteps:\n  - id: login\n    name: 로그인\n    server: api\n    api: {method: POST, path: /login}\n';
    const bindings = {api:serverId};
    const draft = await workspace.saveScenarioDraft(scope,source,bindings);
    assert.equal(draft.draft,true);
    assert.equal((await workspace.listScenarios(projectId)).length,1);
    await assert.rejects(workspace.runScenario(scope,source,bindings,{}), /명세/);
    await assert.rejects(workspace.saveScenarioDraft(scope,source,bindings), /같은 ID/);
    const spec = JSON.stringify({openapi:"3.0.3",info:{title:"명세",version:"1"},paths:{"/login":{post:{responses:{"200":{description:"성공"}}}}}});
    await workspace.importSpec(scope,spec);
    await workspace.importSpec({...scope,environmentId:dev},spec);
    assert.deepEqual((await workspace.previewScenario(scope,source,bindings)).issues,[]);
    await assert.rejects(workspace.runScenario({...scope,environmentId:dev},source,bindings,{}), /지원 환경/);
    assert.equal((await workspace.saveScenario(scope,source,bindings,draft.updatedAt)).draft,false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Swagger credentials are explicit and URL userinfo and colon usernames are rejected", () => {
  assert.equal(specSourceSchema.safeParse({kind:"url",url:"https://example.com/openapi.json",auth:{kind:"basic",username:"docs",password:""}}).success,true);
  assert.equal(specSourceSchema.safeParse({kind:"url",url:"https://docs:secret@example.com/openapi.json"}).success,false);
  assert.equal(specSourceSchema.safeParse({kind:"url",url:"https://example.com",auth:{kind:"basic",username:"a:b",password:"secret"}}).success,false);
});
