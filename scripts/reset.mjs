#!/usr/bin/env node
// Reset the running app to a fresh session: POST /api/reset (rules back to defaults, decision log cleared, tokens ended; worker credentials kept).
// The page's Reset session button also puts the diagram boxes back. If the app is not running there is nothing to reset (the session
// lives in memory), which is reported, not an error. Loopback only: refuses any other host.
//   node scripts/reset.mjs [base-url]        (npm run reset; default http://127.0.0.1:${PORT:-4850})
import { pathToFileURL } from 'node:url';
import { isLoopbackHost } from '../server/src/security.js';

export async function reset(base = `http://127.0.0.1:${Number(process.env.PORT) || 4850}`) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  // The server only accepts writes from its own origin, so the script sends the same Origin the page would.
  const res = await fetch(new URL('/api/reset', u), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: u.origin }, body: '{}', signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`reset failed: HTTP ${res.status}`);
  return { base: u.origin, ...body };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = await reset(process.argv[2]);
    console.log(`reset: cleared ${r.cleared.join(', ')}; kept ${r.kept.join(', ')} (${r.base})`);
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.name === 'TimeoutError') { console.log('reset: nothing to do, the app is not running'); process.exit(0); }
    console.error(err.message); process.exit(1);
  }
}
