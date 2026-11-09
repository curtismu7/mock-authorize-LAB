'use strict';

// Guards from the independent review: each one fails when its line is removed (the review found none of them tested).
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { installNetguard, isActive } from '../src/netguard.js';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-guards-'));
  const server = createApp({ env: { DATA_DIR: dir } }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  return { port, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const rawRequest = (port, { method = 'GET', path: p = '/api/info', host, body, origin }) => new Promise((resolve, reject) => {
  const headers = { Host: host ?? `127.0.0.1:${port}` };
  if (origin) headers.Origin = origin;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve({ status: r.statusCode, body: b, headers: r.headers }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(body);
  req.end();
});

test('a foreign Host header is refused on every route (DNS-rebinding guard)', async () => {
  const t = await boot();
  try {
    assert.equal((await rawRequest(t.port, { p: '/api/worker', host: 'evil.example' })).status, 403);
    assert.equal((await rawRequest(t.port, { path: '/api/worker', host: 'evil.example' })).status, 403);
    assert.equal((await rawRequest(t.port, { path: '/api/info' })).status, 200);
  } finally { await t.close(); }
});

test('a body over the limit is refused with 413 and never parsed', async () => {
  const t = await boot();
  try {
    const big = JSON.stringify({ parameters: { pad: 'x'.repeat(300 * 1024) } });
    const r = await rawRequest(t.port, { method: 'POST', path: '/api/try', body: big, origin: t.base });
    assert.equal(r.status, 413);
  } finally { await t.close(); }
});

test('nesting deeper than the limit is refused, and the decision log still works afterwards', async () => {
  const t = await boot();
  try {
    // Built as text: JSON.stringify of 10000 nested objects would overflow the test's own stack.
    const body = '{"parameters":{"Amount":1,"deep":' + '{"n":'.repeat(10000) + '1' + '}'.repeat(10000) + '}}';
    const r = await rawRequest(t.port, { method: 'POST', path: '/api/try', body, origin: t.base });
    assert.equal(r.status, 400);
    assert.equal((await rawRequest(t.port, { path: '/api/decisions' })).status, 200);
  } finally { await t.close(); }
});

test('a valid incoming traceparent is kept and recorded; without one the server makes one', async () => {
  const t = await boot();
  try {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const kept = await rawRequest(t.port, { method: 'POST', path: '/api/try', body: JSON.stringify({ parameters: { Amount: 1 } }), origin: t.base, });
    assert.match(kept.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    const sent = await fetch(`${t.base}/api/try`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: t.base, traceparent: tp }, body: JSON.stringify({ parameters: { Amount: 1 } }) });
    assert.equal(sent.headers.get('traceparent'), tp);
    const log = await (await fetch(`${t.base}/api/decisions`)).json();
    assert.equal(log.decisions[0].traceparent, tp);
  } finally { await t.close(); }
});

test('the netguard refuses an outbound call once installed (zero outbound)', async () => {
  installNetguard();
  assert.equal(isActive(), true);
  await assert.rejects(() => fetch('https://example.com/'));
});

// Behind the family lab-proxy (https://local.ping-devops.com:8443): Host is this lab's LAB_ALLOWED_HOSTS name with its port,
// the browser's Origin is the proxy's, and the proxy says so in X-Forwarded-Host/-Proto.
test('lab-proxy: LAB_ALLOWED_HOSTS parsing', async () => {
  const { parseAllowedHosts } = await import('../src/security.js');
  assert.deepEqual([...parseAllowedHosts({})], []);
  assert.deepEqual([...parseAllowedHosts({ LAB_ALLOWED_HOSTS: ' Mock-Authorize.local.ping-devops.com , ' })], ['mock-authorize.local.ping-devops.com']);
  for (const bad of ['a.example:4850', 'https://a.example', 'a b']) assert.throws(() => parseAllowedHosts({ LAB_ALLOWED_HOSTS: bad }), /not a host name/);
});

test('lab-proxy: launcher Host accepted, proxied same-origin write accepted, everything else still refused', async () => {
  const name = 'mock-authorize.local.ping-devops.com';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-proxy-'));
  const server = createApp({ env: { DATA_DIR: dir, LAB_ALLOWED_HOSTS: name, PORT: '4850' } }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const send = (method, p, headers, body) => new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body !== undefined) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve({ status: r.statusCode, body: b }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  const body = JSON.stringify({ source: 'mock' });
  const proxy = 'https://local.ping-devops.com:8443';
  const fwd = { 'X-Forwarded-Host': 'local.ping-devops.com:8443', 'X-Forwarded-Proto': 'https' };
  const launcher = `${name}:4850`;
  try {
    // launcher Host accepted (and loopback still is)
    assert.equal((await send('GET', '/api/health', { Host: launcher })).status, 200);
    assert.equal((await send('GET', '/api/health', { Host: `127.0.0.1:${port}` })).status, 200);
    // proxied same-origin write accepted
    const ok = await send('POST', '/api/mode', { Host: launcher, ...fwd, Origin: proxy }, body);
    assert.equal(ok.status, 200, ok.body);
    // foreign Origin refused, and an Origin that does not match the forwarded host or scheme
    for (const origin of ['https://evil.example', 'http://local.ping-devops.com:8443', 'https://local.ping-devops.com']) {
      const r = await send('POST', '/api/mode', { Host: launcher, ...fwd, Origin: origin }, body);
      assert.equal(r.status, 403, origin);
      assert.match(r.body, /cross_origin/);
    }
    assert.equal((await send('POST', '/api/mode', { Host: launcher, 'X-Forwarded-Host': 'local.ping-devops.com:8443', 'X-Forwarded-Proto': 'ftp', Origin: 'ftp://local.ping-devops.com:8443' }, body)).status, 403);
    assert.equal((await send('POST', '/api/mode', { Host: launcher, ...fwd }, body)).status, 403, 'a write still needs an Origin');
    // forwarded headers on a loopback Host are ignored
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      assert.equal((await send('POST', '/api/mode', { Host: host, ...fwd, Origin: proxy }, body)).status, 403, host);
    }
    // a Host outside the set is refused: the bare proxy name, another name, the right name on another port, no port
    for (const host of ['local.ping-devops.com:4850', 'local.ping-devops.com:8443', 'evil.example:4850', `${name}:4851`, name]) {
      const r = await send('GET', '/api/health', { Host: host });
      assert.equal(r.status, 403, host);
      assert.match(r.body, /bad_host/);
    }
  } finally { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); }
  // without LAB_ALLOWED_HOSTS the launcher Host is refused
  const plain = createApp({ env: { DATA_DIR: dir } }).listen(0, '127.0.0.1');
  await new Promise((r) => plain.once('listening', r));
  try {
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: plain.address().port, path: '/api/health', headers: { Host: launcher } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(r, 403);
  } finally { await new Promise((r) => { plain.closeAllConnections?.(); plain.close(r); }); }
});
