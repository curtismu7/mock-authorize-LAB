import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { modeFrom, port as configPort } from './config.js';
import { allPassed, runChecks } from './doctor.js';
import { installNetguard } from './netguard.js';
import { assertBindAllowed, bindHost } from './security.js';
import { applySharedSettings } from './settings.js';

// Boot on `port` (0 = ephemeral). Refuses a non-loopback host unless MOCKAZ_BIND is set.
export function startHttpServer({ port = configPort(), host = bindHost(), app = createApp() } = {}) {
  assertBindAllowed(host);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('error', reject);
    server.once('listening', () => {
      const { port: bound } = server.address();
      resolve({
        port: bound, host, url: `http://127.0.0.1:${bound}/`,
        close: async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); },
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  installNetguard(); // zero outbound, before anything else can open a socket
  // The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this app's own key is taken; never printed.
  applySharedSettings();
  const checks = runChecks();
  if (!allPassed(checks)) {
    for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[mock-authorize] refusing to start: ${c.id}: ${c.detail}`);
    process.exit(1);
  }
  const mode = modeFrom(process.env); // refuses live
  const { port: bound, host } = await startHttpServer();
  console.log(`[mock-authorize] ${mode} mode, bound to ${host}:${bound} (loopback unless MOCKAZ_BIND is set; Docker publishes 127.0.0.1 only)`);
  process.on('SIGTERM', () => process.exit(0));
}
