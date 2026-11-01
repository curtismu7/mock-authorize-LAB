// Rule 1: zero real outbound, with no exceptions. This app only ever answers; it has no reason to leave the machine.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { installNetguard, isActive, netguardSelfTest } from '../src/netguard.js';

const ENV = '00000000-0000-4000-8000-000000000000';

test('self-test: every route out is refused and recorded, none reaches the network', async () => {
  const r = await netguardSelfTest();
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.blocked, 7);
  assert.match(r.detail, /fetch: blocked.*socket: blocked.*socket-ip: blocked.*dns: blocked.*dns-resolve: blocked.*udp: blocked.*udp-connect: blocked/);
  installNetguard().restore();
});

test('a real outbound attempt is blocked and appears in attempts', async () => {
  const g = installNetguard();
  // The timeout makes a loosened fetch guard fail fast (TimeoutError) instead of hanging on a real lookup.
  await assert.rejects(fetch('https://example.invalid/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
  await assert.rejects(new Promise((res, rej) => { const q = http.get('http://other.invalid/', res); q.on('error', rej); }), /network blocked|ENOTFOUND|blocked/);
  assert.ok(g.attempts.some((a) => a === 'fetch:example.invalid'));
  assert.ok(g.attempts.some((a) => a.includes('other.invalid')));
  g.restore();
});

test('loopback still works under the guard', async () => {
  const g = installNetguard();
  const server = http.createServer((_q, s) => s.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(3000) });
    assert.equal(await res.text(), 'ok');
    assert.deepEqual(g.attempts, []);
  } finally { await new Promise((r) => server.close(r)); g.restore(); } // always close: a failed assertion must not leave a listener that hangs the run
});

test('restore puts the real functions back', async () => {
  const before = net.Socket.prototype.connect;
  const g = installNetguard();
  assert.notEqual(net.Socket.prototype.connect, before);
  g.restore();
  assert.equal(net.Socket.prototype.connect, before);
});

test('raw IP-literal sockets are refused and recorded as socket:<ip>', async () => {
  const g = installNetguard();
  assert.throws(() => net.connect({ host: '192.0.2.1', port: 80 }), /network blocked: 192\.0\.2\.1/);
  assert.throws(() => net.connect(80, '192.0.2.2'), /network blocked: 192\.0\.2\.2/);
  assert.throws(() => http.get({ host: '192.0.2.3', port: 80 }), /network blocked: 192\.0\.2\.3/);
  assert.deepEqual(g.attempts.filter((a) => a.startsWith('socket:')), ['socket:192.0.2.1', 'socket:192.0.2.2', 'socket:192.0.2.3']);
  g.restore();
});

test('a wildcard bind (container MOCKAZ_BIND=0.0.0.0) can listen, but connecting to it is still refused', async () => {
  const g = installNetguard();
  const srv = net.createServer((c) => c.end());
  await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '0.0.0.0', res); });
  try {
    const { port } = srv.address();
    assert.deepEqual(g.attempts, [], 'listening is not an outbound attempt');
    await assert.rejects(new Promise((res, rej) => { try { const s = net.connect({ host: '0.0.0.0', port }); s.on('error', rej); s.on('connect', () => { s.destroy(); res(); }); } catch (e) { rej(e); } }), /network blocked/);
    assert.ok(g.attempts.includes('socket:0.0.0.0'));
  } finally { await new Promise((r) => srv.close(r)); g.restore(); }
});

test('dns.resolve*, dns.promises.* and Resolver are refused and recorded; loopback names pass the check', async () => {
  const g = installNetguard();
  await assert.rejects(dns.promises.resolve4('probe.invalid'), /network blocked/);
  await assert.rejects(dns.promises.lookup('probe2.invalid'), /network blocked/);
  await assert.rejects(new dns.promises.Resolver().resolve4('probe3.invalid'), /network blocked/);
  await new Promise((res) => dns.resolve4('probe4.invalid', (e) => { assert.match(e.message, /network blocked/); res(); }));
  for (const h of ['probe', 'probe2', 'probe3', 'probe4']) assert.ok(g.attempts.includes(`dns:${h === 'probe' ? 'probe' : h}.invalid`), h);
  g.restore();
});

test('udp: the address is found by position, so a message body cannot masquerade as it', () => {
  const g = installNetguard();
  const s = dgram.createSocket('udp4');
  try {
    assert.throws(() => s.send('127.0.0.1', 9, 'evil.invalid'), /network blocked: evil\.invalid/);
    assert.throws(() => s.send(Buffer.from('x'), 0, 1, 9, 'evil2.invalid'), /network blocked: evil2\.invalid/);
    assert.throws(() => s.send('x', 9, 'evil3.invalid', () => {}), /network blocked: evil3\.invalid/);
    assert.deepEqual(g.attempts.filter((a) => a.startsWith('udp:')), ['udp:evil.invalid', 'udp:evil2.invalid', 'udp:evil3.invalid']);
    s.send('plain message', 9, '127.0.0.1', () => {}); // a string body is fine for loopback
  } finally { s.close(); g.restore(); }
});

test('udp connect(): the peer is checked, because a later send() with no address goes there', () => {
  const g = installNetguard();
  const s = dgram.createSocket('udp4');
  try {
    assert.throws(() => s.connect(9, '192.0.2.44'), /network blocked: 192\.0\.2\.44/);
    assert.throws(() => s.connect(9, 'peer.invalid'), /network blocked: peer\.invalid/);
    assert.deepEqual(g.attempts.filter((a) => a.startsWith('udp-connect:')), ['udp-connect:192.0.2.44', 'udp-connect:peer.invalid']);
  } finally { s.close(); g.restore(); }
});

test('udp connect() to loopback is allowed and restore() puts the real connect back', () => {
  const before = dgram.Socket.prototype.connect;
  const g = installNetguard();
  assert.notEqual(dgram.Socket.prototype.connect, before);
  const s = dgram.createSocket('udp4');
  try {
    s.connect(9, '127.0.0.1');
    assert.deepEqual(g.attempts, []);
  } finally { s.close(); g.restore(); }
  assert.equal(dgram.Socket.prototype.connect, before);
});

test('isActive reflects whether the guard is installed', () => {
  assert.equal(isActive(), false);
  const g = installNetguard();
  assert.equal(isActive(), true);
  g.restore();
  assert.equal(isActive(), false);
});

// ---- the whole app under the guard: zero attempts ----

test('a whole session (console API, PingOne-shaped API with a worker token, on-prem path, Try, Reset) makes ZERO outbound attempts', async () => {
  const g = installNetguard();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-ng-'));
  const server = createApp({ env: { DATA_DIR: dir } }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, { body, headers = {}, form } = {}) => {
    const h = { Origin: base, ...headers };
    let payload;
    if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetch(base + url, { method, headers: h, body: payload });
  };
  try {
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal((await call('GET', '/api/config')).status, 200);
    assert.equal((await call('GET', '/api/info')).status, 200);
    assert.equal((await call('GET', '/api/diagram?name=mock-authorize-flow')).status, 200);
    assert.equal((await call('GET', '/api/rules')).status, 200);
    const w = await (await call('GET', '/api/worker')).json();
    const basic = Buffer.from(`${w.clientId}:${w.clientSecret}`).toString('base64');
    const tok = await (await call('POST', `/pingone/auth/${ENV}/as/token`, { headers: { Authorization: `Basic ${basic}` }, form: { grant_type: 'client_credentials' } })).json();
    const auth = { Authorization: `Bearer ${tok.access_token}` };
    assert.equal((await call('GET', `/pingone/api/v1/environments/${ENV}/decisionEndpoints`, { headers: auth })).status, 200);
    const d = await call('POST', `/pingone/api/v1/environments/${ENV}/decisionEndpoints/mock-transaction`, { headers: auth, body: { parameters: { Amount: 5000, TransactionType: 'transfer' } } });
    assert.equal((await d.json()).decision, 'DENY');
    assert.equal((await call('GET', `/pingone/api/v1/environments/${ENV}/decisionEndpoints/mock-transaction/recentDecisions`, { headers: auth })).status, 200);
    assert.equal((await call('POST', '/governance/pap/alpha/policy/mcp-gateway-policy/decision', { body: { parameters: { ToolName: 'delete_account' } } })).status, 200);
    assert.equal((await call('POST', '/api/try', { body: { parameters: { Amount: 50, TransactionType: 'deposit' } } })).status, 200);
    assert.equal((await call('GET', '/api/decisions')).status, 200);
    assert.equal((await call('POST', '/api/reset', { body: {} })).status, 200);
    assert.deepEqual(g.attempts, [], 'a whole session never tries to leave the machine');
  } finally { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); g.restore(); }
});
