// Preflight: the same checks GET /api/health reports from, plus the netguard self-test, one real decision through the HTTP layer
// on a throwaway port (isolated temp data dir), and whether the port is free. Prints only pass/fail lines, never the value of a
// setting. Exit 1 on any failure. Needs no network beyond loopback.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { applySharedSettings } = await load('server/src/settings.js');
applySharedSettings(); // the one shared settings file (~/Development/.env or STANDALONE_ENV); only this app's own key is taken

const { runChecks } = await load('server/src/doctor.js');
const { port: configPort } = await load('server/src/config.js');
let failed = 0;
const report = (level, name, detail) => {
  if (level === 'fail') failed++;
  console.log(`${level.toUpperCase().padEnd(5)} ${name}: ${detail}`);
};

for (const c of runChecks()) report(c.level, c.id, c.detail);

// Rule 1: prove the guard works by trying to leave and checking every attempt is refused (never touches the network).
const { netguardSelfTest } = await load('server/src/netguard.js');
const guard = await netguardSelfTest();
report(guard.ok ? 'pass' : 'fail', 'netguard-selftest', guard.ok ? `${guard.blocked} routes out refused (fetch, sockets, DNS, UDP send and connect)` : guard.detail);

// A real decision through the HTTP layer, in this process, on an ephemeral loopback port and a throwaway data dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-doctor-'));
try {
  const { createApp } = await load('server/src/app.js');
  const { createHealth } = await load('server/src/health.js');
  const health = createHealth({ runChecks: () => [], intervalMs: 3_600_000 });
  const server = createApp({ env: { DATA_DIR: dir }, health }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const h = await (await fetch(`${base}/api/health`)).json();
    const d = await (await fetch(`${base}/api/try`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ parameters: { Amount: 5000, TransactionType: 'deposit' } }) })).json();
    const ok = h.schema === 'demo-health/1' && d.decision === 'DENY' && d.decisionResponse?.statements?.[0]?.code === 'transaction-denied';
    report(ok ? 'pass' : 'fail', 'decision-cycle', ok ? 'health answers demo-health/1 and a 5000 deposit is denied by the default rules' : 'the health or decision call did not answer as expected');
  } finally { health.stop(); await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); }
} catch { report('fail', 'decision-cycle', 'the HTTP cycle could not run'); }
fs.rmSync(dir, { recursive: true, force: true });

const port = configPort();
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report('fail', 'port', `${port} is not free (${e.code}). Start on another port: PORT=<other port> npm start`); resolve(); });
  s.listen(port, '127.0.0.1', () => s.close(() => { report('pass', 'port', `${port} is free`); resolve(); }));
});

process.exit(failed ? 1 : 0);
