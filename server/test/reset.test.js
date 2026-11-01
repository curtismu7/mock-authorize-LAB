// Rule 3: Reset (API + script). Back to a fresh session without silently breaking a client that holds the worker secret.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { DEFAULT_RULES } from '../src/rules.js';

const ENV = '00000000-0000-4000-8000-000000000000';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-reset-'));
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
  return { call, token, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

test('POST /api/reset restores the default rules, clears the decision log and ends issued tokens', async () => {
  const t = await boot();
  try {
    const edit = await t.call('PUT', '/api/rules', { body: { denyAmountUsd: 1234 } });
    assert.equal(edit.status, 200);
    assert.equal((await t.call('GET', '/api/rules')).body.rules.denyAmountUsd, 1234);
    await t.call('POST', '/api/try', { body: { parameters: { Amount: 5000, TransactionType: 'transfer' } } });
    assert.equal((await t.call('GET', '/api/decisions')).body.decisions.length, 1);
    const tok = await t.token();
    assert.equal((await t.call('GET', `/pingone/api/v1/environments/${ENV}/decisionEndpoints`, { headers: { Authorization: `Bearer ${tok}` } })).status, 200);

    const r = await t.call('POST', '/api/reset', { body: {} });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, cleared: ['rules', 'decisions', 'tokens'], revokedTokens: 1, kept: ['worker credentials'] });
    assert.equal((await t.call('GET', '/api/rules')).body.rules.denyAmountUsd, DEFAULT_RULES.denyAmountUsd);
    assert.deepEqual((await t.call('GET', '/api/rules')).body.edited, []);
    assert.equal((await t.call('GET', '/api/decisions')).body.decisions.length, 0);
    assert.equal((await t.call('GET', `/pingone/api/v1/environments/${ENV}/decisionEndpoints`, { headers: { Authorization: `Bearer ${tok}` } })).status, 401, 'the old token no longer works');
  } finally { await t.close(); }
});

test('Reset keeps the worker credentials: a client that already has the secret still gets a token', async () => {
  const t = await boot();
  try {
    const before = (await t.call('GET', '/api/worker')).body;
    await t.call('POST', '/api/reset', { body: {} });
    assert.deepEqual((await t.call('GET', '/api/worker')).body, before);
    assert.ok(await t.token(), 'the same credentials still mint a token');
  } finally { await t.close(); }
});

test('Reset is a write: it refuses a cross-origin request like every other console write', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('POST', '/api/reset', { body: {}, headers: { Origin: 'http://evil.example' } })).status, 403);
  } finally { await t.close(); }
});

test('Reset is idempotent: resetting twice is fine', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('POST', '/api/reset', { body: {} })).status, 200);
    assert.equal((await t.call('POST', '/api/reset', { body: {} })).status, 200);
  } finally { await t.close(); }
});
