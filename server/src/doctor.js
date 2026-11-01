// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a value that
// could be a secret (no tokens, no env values). Each check: { id, level: 'pass' | 'info' | 'setup' | 'fail', detail }.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, modeFrom } from './config.js';
import { isActive } from './netguard.js';
import { assertBindAllowed, bindHost } from './security.js';

export function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try {
    const host = assertBindAllowed(bindHost(env), env);
    add('bind', 'pass', env.MOCKAZ_BIND ? `${host} (MOCKAZ_BIND opt-in)` : `${host} (loopback)`);
  } catch (e) { add('bind', 'fail', e.message); }

  // Rule 1: zero real outbound. The guard is installed when the server starts.
  add('netguard', isActive() ? 'pass' : 'info', isActive() ? 'active: every non-loopback connection is refused' : 'installs when the server starts (npm start); run `npm test` for its self-test');

  // This app has no live mode: mock is the only value, and a settings file asking for live is refused with the reason.
  try { const mode = modeFrom(env); add('mode', 'pass', `${mode} (the only mode: nothing here talks to PingOne)`); } catch (e) { add('mode', 'fail', e.message); }

  const dir = dataDir(env);
  try {
    if (fs.existsSync(dir)) {
      const mode = fs.statSync(dir).mode & 0o777;
      add('state-dir', mode & 0o077 ? 'fail' : 'pass', `${dir} mode ${mode.toString(8)}${mode & 0o077 ? ' (must be 700: run chmod 700)' : ''}`);
      const file = `${dir}/worker.json`;
      if (fs.existsSync(file)) {
        const fm = fs.statSync(file).mode & 0o777;
        add('worker-file', fm & 0o077 ? 'fail' : 'pass', `mode ${fm.toString(8)}${fm & 0o077 ? ' (must be 600: run chmod 600)' : ''}`);
      }
    } else add('state-dir', 'pass', `${dir} does not exist yet (created with mode 700 on first save)`);
  } catch (e) { add('state-dir', 'fail', `cannot read ${dir}: ${e.code || 'error'}`); }

  const rulesFile = path.join(dataDir(env), 'rules.json');
  if (fs.existsSync(rulesFile)) {
    try { JSON.parse(fs.readFileSync(rulesFile, 'utf8')); add('rules-file', 'pass', 'saved rules readable'); } catch { add('rules-file', 'fail', `${rulesFile} is not valid JSON (delete it to return to the default rules)`); }
  } else add('rules-file', 'pass', 'no saved rules yet (default rules in use)');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
export const needsSetup = (checks) => checks.some((c) => c.level === 'setup');
