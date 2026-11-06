// The standard pieces: settings from the one shared file, the mock-only mode, the diagram as data, health and doctor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { LIVE_REFUSAL, modeFrom } from '../src/config.js';
import { DIAGRAM_NAMES, loadDiagram } from '../src/diagramData.js';
import { validateDiagram } from '../src/diagramStudioValidate.js';
import { createDecisionLog, MAX_BYTES } from '../src/decisions.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { evaluate } from '../src/engine.js';
import { DEFAULT_RULES } from '../src/rules.js';
import { assertBindAllowed } from '../src/security.js';
import { applySharedSettings, readSharedSettings, SETTINGS_KEYS } from '../src/settings.js';

async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-lab-'));
  const server = createApp({ env: { DATA_DIR: dir, ...env } }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, dir, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const tmpFile = (text) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-env-')), '.env'); fs.writeFileSync(f, text, { mode: 0o600 }); return f; };

test('mode: mock is the default and the only value; live is refused with the reason, never a silent fallback', () => {
  assert.equal(modeFrom({}), 'mock');
  assert.equal(modeFrom({ MOCKAZ_LAB_MODE: '' }), 'mock');
  assert.equal(modeFrom({ MOCKAZ_LAB_MODE: 'mock' }), 'mock');
  assert.throws(() => modeFrom({ MOCKAZ_LAB_MODE: 'live' }), (e) => e.message === LIVE_REFUSAL);
  assert.throws(() => modeFrom({ MOCKAZ_LAB_MODE: 'hosted' }), /not a mode this app has/);
  assert.equal(modeFrom({ MODE: 'live' }), 'mock', 'a bare MODE (another app\'s) is never read');
});

test('settings: only this app\'s own key is taken from the shared file; nothing else enters the environment', () => {
  assert.deepEqual(SETTINGS_KEYS, ['MOCKAZ_LAB_MODE']);
  const file = tmpFile('PINGONE_CLIENT_SECRET=do-not-read\nMODE=live\nMOCKAZ_LAB_MODE=mock\nPORT=1\n');
  assert.deepEqual(readSharedSettings(file), { MOCKAZ_LAB_MODE: 'mock' });
  const env = {};
  applySharedSettings(env, file);
  assert.deepEqual(env, { MOCKAZ_LAB_MODE: 'mock' });
  assert.deepEqual(readSharedSettings('/no/such/file'), {}, 'no file: the defaults');
});

test('settings: a real environment variable wins over the file, and STANDALONE_ENV names the file', () => {
  const file = tmpFile('MOCKAZ_LAB_MODE=live\n');
  const env = { MOCKAZ_LAB_MODE: 'mock', STANDALONE_ENV: file };
  applySharedSettings(env);
  assert.equal(env.MOCKAZ_LAB_MODE, 'mock');
});

test('GET /api/info says mock, simulated, and carries the rule-19 toggle shape with an honest realReason', async () => {
  const t = await boot();
  try {
    const info = await (await fetch(`${t.base}/api/info`)).json();
    assert.deepEqual(info, { mode: 'mock', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL, simulated: true, live: false, liveMessage: LIVE_REFUSAL });
  } finally { await t.close(); }
});

test('rule 19: POST /api/mode takes exactly {source}, refuses real with 409 and the honest reason, and never changes the mode', async () => {
  const t = await boot();
  try {
    const postMode = (body) => fetch(`${t.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: t.base }, body: JSON.stringify(body) });
    const mock = await postMode({ source: 'mock' });
    assert.equal(mock.status, 200);
    assert.deepEqual(await mock.json(), { mode: 'mock', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL });
    const real = await postMode({ source: 'real' });
    assert.equal(real.status, 409);
    const rj = await real.json();
    assert.equal(rj.error, 'real_not_available');
    assert.equal(rj.message, LIVE_REFUSAL);
    assert.equal(rj.source, 'mock');
    assert.equal((await (await fetch(`${t.base}/api/info`)).json()).source, 'mock', 'a refused switch leaves the mode unchanged');
    for (const body of [{ source: 'live' }, { source: 1 }, { source: null }, {}, { source: 'mock', extra: 1 }, { mode: 'mock' }, []]) {
      const r = await postMode(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await fetch(`${t.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: t.base } })).status, 400);
    assert.equal((await fetch(`${t.base}/api/mode`)).status, 404, 'there is one toggle endpoint, POST /api/mode');
  } finally { await t.close(); }
});

test('GET /api/health is demo-health/1, ready, offline, and carries no detail', async () => {
  const t = await boot();
  try {
    const r = await fetch(`${t.base}/api/health`);
    const h = await r.json();
    assert.equal(r.status, 200);
    assert.equal(h.schema, 'demo-health/1');
    assert.equal(h.state, 'ready');
    assert.equal(h.runtime, 'offline');
    assert.equal(h.demo.id, 'mock-authorize');
    assert.ok(JSON.stringify(h).length < 4096);
    assert.equal((await fetch(`${t.base}/api/health`, { method: 'POST', headers: { Origin: t.base } })).status, 405);
  } finally { await t.close(); }
});

test('the diagram is diagram-studio/1 data loaded by name; an unknown name is a 404, never a file path', async () => {
  assert.deepEqual(DIAGRAM_NAMES, ['mock-authorize-flow']);
  const doc = loadDiagram('mock-authorize-flow');
  assert.equal(doc.schema, 'diagram-studio/1');
  assert.deepEqual(validateDiagram(doc), []);
  assert.throws(() => loadDiagram('../package'), /no such diagram/);
  const t = await boot();
  try {
    const ok = await fetch(`${t.base}/api/diagram?name=mock-authorize-flow`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), doc);
    assert.equal((await fetch(`${t.base}/api/diagram`)).status, 200, 'no name: the one diagram');
    for (const name of ['../package', 'nope', '..%2f..%2fpackage.json', '__proto__']) assert.equal((await fetch(`${t.base}/api/diagram?name=${name}`)).status, 404, name);
  } finally { await t.close(); }
});

test('the diagram boxes do not overlap in the data (each box is 200 px wide)', () => {
  const doc = loadDiagram('mock-authorize-flow');
  for (const a of doc.nodes) for (const b of doc.nodes) {
    if (a.id < b.id) assert.ok(Math.abs(a.x - b.x) >= 220 || Math.abs(a.y - b.y) >= 120, `${a.id} and ${b.id} overlap`);
  }
});

test('doctor: passes on a clean data dir, refuses a live request with the honest message, and needs Node 26', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-doc-'));
  const ok = runChecks({ env: { DATA_DIR: dir } });
  assert.ok(allPassed(ok), JSON.stringify(ok));
  assert.match(ok.find((c) => c.id === 'node').detail, /need >= 26/);
  const live = runChecks({ env: { DATA_DIR: dir, MOCKAZ_LAB_MODE: 'live' } });
  assert.equal(allPassed(live), false);
  assert.equal(live.find((c) => c.id === 'mode').detail, LIVE_REFUSAL);
});

test('the old MOCKAZ_ALLOWED_HOSTS setting is gone: a foreign Host stays refused even when the variable names it', async () => {
  const t = await boot({ MOCKAZ_ALLOWED_HOSTS: 'evil.example' });
  try {
    const { port } = new URL(t.base);
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/info', headers: { Host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403);
  } finally { await t.close(); }
});

// Safety properties carried over from the old repo's hosted.test.js, which went with the hosted build. The code they guard remains.
test('the bind is loopback unless MOCKAZ_BIND opts in: a wildcard bind is refused without it', () => {
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /refusing to bind/);
  assert.throws(() => assertBindAllowed('192.0.2.10', {}), /refusing to bind/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('localhost', {}), 'localhost');
  assert.equal(assertBindAllowed('0.0.0.0', { MOCKAZ_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('the decision log is bounded by bytes, not only by count: a few large entries cannot hold more than the budget', () => {
  const log = createDecisionLog();
  const big = { id: 'x', parameters: { blob: 'a'.repeat(100 * 1024) } };
  for (let i = 0; i < 5; i++) log.add({ ...big, id: `e${i}` });
  assert.ok(log.bytes() <= MAX_BYTES, `${log.bytes()} bytes <= ${MAX_BYTES}`);
  assert.ok(log.list().length < 5, 'older large entries were dropped');
  assert.equal(log.list()[0].id, 'e4', 'the newest is kept');
  log.add({ id: 'huge', parameters: { blob: 'b'.repeat(2 * MAX_BYTES) } });
  assert.equal(log.list().length, 1, 'an oversized entry is kept alone, not refused');
  log.clear();
  assert.equal(log.bytes(), 0);
});

test('the worker secret is not echoed by the console Try route (only GET /api/worker and rotate return it)', async () => {
  const t = await boot();
  try {
    const w = await (await fetch(`${t.base}/api/worker`)).json();
    assert.ok(w.clientSecret && w.clientSecret.length > 8, 'there is a secret to look for');
    const tr = await fetch(`${t.base}/api/try`, { method: 'POST', headers: { Origin: t.base, 'Content-Type': 'application/json' }, body: JSON.stringify({ parameters: { Amount: 5000, TransactionType: 'transfer' } }) });
    assert.equal(tr.status, 200);
    const text = await tr.text();
    assert.ok(!text.includes(w.clientSecret), 'the Try response carries no worker secret');
    const rec = await (await fetch(`${t.base}/api/decisions`)).text();
    assert.ok(!rec.includes(w.clientSecret), 'nor does the decision log');
  } finally { await t.close(); }
});

test('the deny limit is exclusive: exactly the limit is not denied, one cent over is', () => {
  const lim = DEFAULT_RULES.denyAmountUsd;
  assert.equal(lim, 2000);
  assert.notEqual(evaluate({ Amount: lim, TransactionType: 'deposit' }, DEFAULT_RULES).decision, 'DENY');
  assert.equal(evaluate({ Amount: lim + 0.01, TransactionType: 'deposit' }, DEFAULT_RULES).decision, 'DENY');
  assert.equal(evaluate({ ToolName: 'check_balance', Amount: lim }, DEFAULT_RULES).decision, 'PERMIT');
  assert.equal(evaluate({ ToolName: 'check_balance', Amount: lim + 0.01 }, DEFAULT_RULES).decision, 'DENY');
});

test('recentDecisions: the limit is clamped to 1..20 and defaults to 20', async () => {
  const t = await boot();
  try {
    const ENV = '00000000-0000-4000-8000-000000000000';
    const w = await (await fetch(`${t.base}/api/worker`)).json();
    const basic = Buffer.from(`${w.clientId}:${w.clientSecret}`).toString('base64');
    const tok = (await (await fetch(`${t.base}/pingone/auth/${ENV}/as/token`, { method: 'POST', headers: { Origin: t.base, Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })).json()).access_token;
    const auth = { Authorization: `Bearer ${tok}` };
    for (let i = 0; i < 25; i++) {
      const r = await fetch(`${t.base}/pingone/api/v1/environments/${ENV}/decisionEndpoints/mock-transaction`, { method: 'POST', headers: { ...auth, Origin: t.base, 'Content-Type': 'application/json' }, body: JSON.stringify({ parameters: { Amount: 1, TransactionType: 'deposit' } }) });
      assert.equal(r.status, 200);
    }
    const n = async (q) => (await (await fetch(`${t.base}/pingone/api/v1/environments/${ENV}/decisionEndpoints/mock-transaction/recentDecisions${q}`, { headers: auth })).json()).count;
    assert.equal(await n(''), 20);
    assert.equal(await n('?limit=500'), 20);
    assert.equal(await n('?limit=3'), 3);
    assert.equal(await n('?limit=-5'), 1);
    assert.equal(await n('?limit=abc'), 20);
  } finally { await t.close(); }
});
