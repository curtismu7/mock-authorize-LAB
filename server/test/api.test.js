import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { evaluate } from '../src/engine.js';
import { DEFAULT_RULES, validate } from '../src/rules.js';

const ENV = '00000000-0000-4000-8000-000000000000';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-test-'));
  const server = createApp({ env: { DATA_DIR: dir } }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, form } = {}) => {
    const h = { Origin: base, ...headers };
    let payload;
    if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: payload });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  const token = async () => {
    const { body: w } = await call('GET', '/api/worker');
    const basic = Buffer.from(`${w.clientId}:${w.clientSecret}`).toString('base64');
    return (await call('POST', `/pingone/auth/${ENV}/as/token`, { headers: { Authorization: `Basic ${basic}` }, form: { grant_type: 'client_credentials' } })).body.access_token;
  };
  return { call, token, base, dir, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const EP = `/pingone/api/v1/environments/${ENV}/decisionEndpoints`;

test('engine: the rules, in PingOne shape, with gates as statement codes', () => {
  const r = DEFAULT_RULES;
  const dec = (p) => evaluate(p, r);
  assert.equal(dec({ Amount: 5000, TransactionType: 'transfer' }).decision, 'DENY');
  const consent = dec({ Amount: 100, TransactionType: 'transfer' });
  assert.equal(consent.decision, 'PERMIT');
  assert.equal(consent.statements[0].code, 'HITL_CONSENT');
  assert.equal(dec({ Amount: 600, TransactionType: 'withdrawal' }).statements[0].code, 'STEP_UP_MFA');
  assert.equal(dec({ Amount: 600, TransactionType: 'withdrawal', Acr: 'Multi_Factor' }).statements[0].code, 'permit');
  assert.equal(dec({ DecisionContext: 'McpToolCall', ToolName: 'delete_account' }).decision, 'DENY');
  assert.equal(dec({ DecisionContext: 'McpFirstTool', ToolName: 'create_transfer' }).statements[0].code, 'HITL_CONSENT');
  assert.equal(dec({ DecisionContext: 'McpFirstTool', ToolName: 'create_transfer', HitlApproved: true }).statements[0].code, 'permit');
  const sample = dec({ Amount: 1, TransactionType: 'deposit' });
  assert.ok(sample.correlationId && typeof sample.elapsedMicroseconds === 'number');
});

test('engine: a request with nothing readable is INDETERMINATE, not a permit', () => {
  assert.equal(evaluate({ Foo: 'bar' }, DEFAULT_RULES).decision, 'INDETERMINATE');
  assert.equal(evaluate({ DecisionContext: 'McpToolCall' }, DEFAULT_RULES).decision, 'INDETERMINATE');
});

test('on-prem PingAuthorize shape: POST /governance/pap/alpha/policy/{id}/decision, no token, gateway-style parameters', async () => {
  const t = await boot();
  try {
    const url = '/governance/pap/alpha/policy/mcp-gateway-policy/decision';
    const gate = await t.call('POST', url, { body: { parameters: { DecisionContext: 'McpToolCall', McpMethod: 'tools/call', ToolName: 'create_transfer', TransactionAmount: '100', HitlApproved: '' } } });
    assert.equal(gate.status, 200);
    assert.equal(gate.body.decision, 'PERMIT');
    assert.equal(gate.body.statements[0].code, 'HITL_CONSENT');
    const approved = await t.call('POST', url, { body: { parameters: { DecisionContext: 'McpToolCall', ToolName: 'create_transfer', HitlApproved: 'true' } } });
    assert.equal(approved.body.statements[0].code, 'permit');
    const over = await t.call('POST', url, { body: { parameters: { DecisionContext: 'McpToolCall', ToolName: 'get_balance', TransactionAmount: '5000' } } });
    assert.equal(over.body.decision, 'DENY');
    assert.equal((await t.call('POST', url, { body: { parameters: [] } })).status, 400);
    const { body } = await t.call('GET', '/api/decisions');
    assert.equal(body.decisions.length, 3);
    assert.equal(body.decisions[0].endpointId, 'mcp-gateway-policy');
    assert.equal(body.decisions[0].source, 'api');
  } finally { await t.close(); }
});

test('rules validation refuses unknown keys, wrong types and oversized lists', () => {
  assert.ok(validate({ denyAmountUsd: 10 }).rules);
  for (const bad of [{ nope: 1 }, { denyAmountUsd: '10' }, { denyAmountUsd: -1 }, { denyTools: 'x' }, { denyTools: [''] }, { hitlTools: new Array(101).fill('a') }, []]) {
    assert.ok(validate(bad).error, JSON.stringify(bad).slice(0, 40));
  }
});

test('token endpoint: needs the worker credentials and client_credentials', async () => {
  const t = await boot();
  try {
    const { body: w } = await t.call('GET', '/api/worker');
    const basic = (s) => ({ Authorization: `Basic ${Buffer.from(`${w.clientId}:${s}`).toString('base64')}` });
    assert.equal((await t.call('POST', `/pingone/auth/${ENV}/as/token`, { headers: basic('wrong'), form: { grant_type: 'client_credentials' } })).status, 401);
    assert.equal((await t.call('POST', `/pingone/auth/${ENV}/as/token`, { form: { grant_type: 'client_credentials' } })).status, 401);
    assert.equal((await t.call('POST', `/pingone/auth/${ENV}/as/token`, { headers: basic(w.clientSecret), form: { grant_type: 'password' } })).status, 400);
    const ok = await t.call('POST', `/pingone/auth/${ENV}/as/token`, { headers: basic(w.clientSecret), form: { grant_type: 'client_credentials' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.token_type, 'Bearer');
  } finally { await t.close(); }
});

test('decision endpoints need a worker token; list, decide and recent decisions work with one', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', EP)).status, 401);
    assert.equal((await t.call('GET', EP, { headers: bearer('mock-nope') })).status, 401);
    const tok = await t.token();
    const list = await t.call('GET', EP, { headers: bearer(tok) });
    assert.deepEqual(list.body._embedded.decisionEndpoints.map((e) => e.id), ['mock-transaction', 'mock-mcp']);
    const d = await t.call('POST', `${EP}/mock-transaction`, { headers: bearer(tok), body: { parameters: { Amount: 5000, TransactionType: 'transfer' } } });
    assert.equal(d.status, 200);
    assert.equal(d.body.decision, 'DENY');
    assert.ok(d.body.correlationId);
    assert.equal((await t.call('POST', `${EP}/nope`, { headers: bearer(tok), body: { parameters: {} } })).status, 404);
    assert.equal((await t.call('POST', `${EP}/mock-transaction`, { headers: bearer(tok), body: { parameters: [] } })).status, 400);
    const recent = await t.call('GET', `${EP}/mock-transaction/recentDecisions?limit=5`, { headers: bearer(tok) });
    assert.equal(recent.body._embedded.recentDecisions.length, 1);
    assert.equal(recent.body._embedded.recentDecisions[0].id, d.body.correlationId);
    assert.equal(recent.body._embedded.recentDecisions[0].decisionResponse.decision, 'DENY');
  } finally { await t.close(); }
});

test('editing a rule changes the next decision, persists, and reset returns the defaults', async () => {
  const t = await boot();
  try {
    const before = await t.call('POST', '/api/try', { body: { parameters: { Amount: 3000, TransactionType: 'deposit' } } });
    assert.equal(before.body.decision, 'DENY');
    const put = await t.call('PUT', '/api/rules', { body: { denyAmountUsd: 5000, denyTools: ['wipe_all'] } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.edited.sort(), ['denyAmountUsd', 'denyTools']);
    assert.equal((await t.call('POST', '/api/try', { body: { parameters: { Amount: 3000, TransactionType: 'deposit' } } })).body.decision, 'PERMIT');
    assert.equal((await t.call('POST', '/api/try', { body: { parameters: { ToolName: 'wipe_all' } } })).body.decision, 'DENY');
    assert.ok(JSON.parse(fs.readFileSync(path.join(t.dir, 'rules.json'), 'utf8')).denyAmountUsd === 5000);
    assert.equal((await t.call('PUT', '/api/rules', { body: { bogus: 1 } })).status, 400);
    const reset = await t.call('POST', '/api/rules/reset', { body: {} });
    assert.equal(reset.body.rules.denyAmountUsd, 2000);
    assert.equal(fs.existsSync(path.join(t.dir, 'rules.json')), false);
  } finally { await t.close(); }
});

test('only values that differ from the defaults count as edited', async () => {
  const t = await boot();
  try {
    const all = { denyAmountUsd: 2000, stepUpAmountUsd: 500, consentTypes: ['transfer'], denyTools: ['delete_account', 'export_all_data'], hitlTools: ['create_transfer', 'create_withdrawal'] };
    assert.deepEqual((await t.call('PUT', '/api/rules', { body: all })).body.edited, []);
    assert.equal(fs.existsSync(path.join(t.dir, 'rules.json')), false);
    assert.deepEqual((await t.call('PUT', '/api/rules', { body: { ...all, denyAmountUsd: 100 } })).body.edited, ['denyAmountUsd']);
    assert.deepEqual((await t.call('PUT', '/api/rules', { body: { denyAmountUsd: 2000 } })).body.edited, []);
  } finally { await t.close(); }
});

test('console decisions and API decisions share one log, with their source', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/try', { body: { parameters: { Amount: 1, TransactionType: 'deposit' } } });
    const tok = await t.token();
    await t.call('POST', `${EP}/mock-mcp`, { headers: bearer(tok), body: { parameters: { ToolName: 'delete_account' } } });
    const { body } = await t.call('GET', '/api/decisions');
    assert.deepEqual(body.decisions.map((d) => d.source), ['api', 'console']);
    assert.equal((await t.call('DELETE', '/api/decisions')).status, 204);
    assert.equal((await t.call('GET', '/api/decisions')).body.decisions.length, 0);
  } finally { await t.close(); }
});

test('rotating the worker secret invalidates the old secret and tokens', async () => {
  const t = await boot();
  try {
    const old = await t.call('GET', '/api/worker');
    const tok = await t.token();
    const next = await t.call('POST', '/api/worker/rotate', { body: {} });
    assert.notEqual(next.body.clientSecret, old.body.clientSecret);
    assert.equal((await t.call('GET', EP, { headers: bearer(tok) })).status, 401);
    assert.equal(fs.statSync(path.join(t.dir, 'worker.json')).mode & 0o777, 0o600);
  } finally { await t.close(); }
});

test('console writes must be same-origin', async () => {
  const t = await boot();
  try {
    const r = await fetch(`${t.base}/api/rules/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' });
    assert.equal(r.status, 403);
  } finally { await t.close(); }
});
