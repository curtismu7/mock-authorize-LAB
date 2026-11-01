// Rule 3: the reset script talks to a running app on loopback only, with the Origin the server requires.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/src/app.js';
import { reset } from './reset.mjs';

test('the script resets a running app (rules, decisions, tokens) and reports what it kept', async () => {
  const server = createApp({ env: { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-rs-')) } }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/rules`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ denyAmountUsd: 77 }) });
    const r = await reset(base);
    assert.deepEqual(r.cleared, ['rules', 'decisions', 'tokens']);
    assert.deepEqual(r.kept, ['worker credentials']);
    assert.equal((await (await fetch(`${base}/api/rules`)).json()).rules.denyAmountUsd, 2000);
  } finally { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); }
});

test('the script refuses a host that is not loopback, before any request', async () => {
  await assert.rejects(reset('http://example.invalid:4850'), /loopback only/);
  await assert.rejects(reset('http://192.0.2.1:4850'), /loopback only/);
});
