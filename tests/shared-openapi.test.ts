import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSharedOpenApi, contractForSharedEvent } from '../src/renderer/pages/form-automation/sharedOpenApi';
import type { NetworkEvent } from '../src/renderer/pages/form-automation/liveQa';

const document = { openapi: '3.0.0', paths: { '/items': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'string' } } } } } } } } } } };
const source = (environmentId: string, baseUrl: string, spec = document) => ({ scope: {projectId:'p',environmentId,serverId:'s'},label:environmentId,baseUrl,document:spec });
const event = {id:'1',type:'fetch',url:'https://proxy.test/items',method:'GET',status:200,responseBody:{count:1}} as NetworkEvent;
test('matches duplicate environment catalogs and validates a unique proxied operation', () => {
  const sources=[source('dev','https://api.test'),source('stage','https://stage.test')];
  assert.ok(matchSharedOpenApi(sources,event.url,event.method));
  assert.equal(contractForSharedEvent(sources,event).tone,'danger');
});
test('does not choose between conflicting catalogs', () => {
  const other={...document,paths:{'/items':{get:{responses:{}}}}};
  assert.equal(matchSharedOpenApi([source('a','https://a.test'),source('b','https://b.test',other)],event.url,event.method),undefined);
});
