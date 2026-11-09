// One Express app: the console API under /api, the PingOne-shaped API under /pingone, and the built web UI when web/dist exists.
// createApp() is what tests use.
//
// Safety rules enforced here (each has a test):
//  - every request: loopback Host check; every console write: same-origin Origin check (security.js)
//  - the PingOne-shaped API needs a worker token; the token endpoint needs the worker credentials
//  - rule edits are validated: unknown keys, wrong types and oversized lists are refused
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { dataDir, LIVE_REFUSAL, port as configPort } from './config.js';
import { loadDiagram } from './diagramData.js';
import { evaluate } from './engine.js';
import { createHealth } from './health.js';
import { createPingAuthorizeRouter, createPingoneRouter, ENDPOINTS } from './pingone.js';
import { clip } from './redact.js';
import { DEFAULT_RULES } from './rules.js';
import { hostCheck, parseAllowedHosts, sameOriginWrites } from './security.js';
import { tooDeep, traceparentFrom } from './limits.js';
import { createWorkspaces } from './workspaces.js';
import { shelfInfo } from './shelfLink.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const bad = (res, message, status = 400, error = 'bad_request') => res.status(status).json({ error, message });
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function createApp({
  env = process.env, rules, worker, log, workspaces = createWorkspaces({ rules, worker, log, dir: dataDir(env) }),
  health = createHealth({ env }), allowedHosts = parseAllowedHosts(env), port = configPort(env),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck(env, { allowedHosts, port }));
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use('/pingone', createPingoneRouter({ workspaces }));
  app.use(createPingAuthorizeRouter({ workspaces }));

  const api = express.Router();
  const small = express.json({ limit: '256kb' });
  api.use(sameOriginWrites({ allowedHosts, port }));
  api.use('/health', health.router);
  // What this build is: the banner on every page reads it. Public, no per-visitor data.
  // This app has no live mode: `live: false` tells the header toggle to refuse Live with the honest message.
  // Rule 19: the Mock/Real toggle. Mock Authorize is itself the mock server, so Real is never available: it is
  // refused with 409 and the honest reason, and the mode never changes. GET /api/info carries the toggle shape.
  api.get('/info', (req, res) => res.json({ mode: 'mock', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL, simulated: true, live: false, liveMessage: LIVE_REFUSAL }));
  api.post('/mode', small, (req, res) => {
    const body = req.body ?? {};
    if (!isObject(body) || Object.keys(body).some((k) => k !== 'source')) return bad(res, 'the only accepted body field is { "source": "mock" | "real" }');
    if (body.source !== 'mock' && body.source !== 'real') return bad(res, 'source must be "mock" or "real"');
    if (body.source === 'real') return res.status(409).json({ error: 'real_not_available', message: LIVE_REFUSAL, source: 'mock' });
    return res.json({ mode: 'mock', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL });
  });
  // The diagram is diagram-studio/1 data, loaded by name (rule 17).
  api.get('/diagram', (req, res) => {
    try { return res.json(loadDiagram(String(req.query.name || 'mock-authorize-flow'))); } catch { return bad(res, 'no such diagram', 404, 'not_found'); }
  });
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.ws = workspaces.forRequest(req, res);
    return next();
  });

  api.get('/config', (req, res) => res.json({ endpoints: ENDPOINTS, defaults: DEFAULT_RULES, pingonePath: '/pingone' }));

  api.get('/rules', (req, res) => res.json({ rules: req.ws.rules.get(), defaults: DEFAULT_RULES, edited: Object.keys(req.ws.rules.overlay()) }));
  api.put('/rules', small, (req, res) => {
    if (tooDeep(req.body)) return bad(res, 'rules nested too deeply');
    const r = req.ws.rules.update(req.body);
    if (r.error) return bad(res, r.error);
    return res.json({ rules: r.rules, defaults: DEFAULT_RULES, edited: Object.keys(req.ws.rules.overlay()) });
  });
  // Reset: back to a fresh session. Rules return to their defaults, the decision log is cleared and every issued token is ended.
  // The worker credentials are KEPT (rotating them would silently break any client you pasted them into; use Rotate for that).
  api.post('/reset', small, (req, res) => {
    req.ws.rules.reset(); req.ws.log.clear(); const revoked = req.ws.worker.revokeTokens();
    res.json({ ok: true, cleared: ['rules', 'decisions', 'tokens'], revokedTokens: revoked, kept: ['worker credentials'] });
  });
  api.post('/rules/reset', small, (req, res) => res.json({ rules: req.ws.rules.reset(), defaults: DEFAULT_RULES, edited: [] }));

  // Try a decision from the console: no token needed, recorded like any other.
  api.post('/try', small, (req, res) => {
    if (!isObject(req.body) || !isObject(req.body.parameters)) return bad(res, 'parameters must be an object');
    if (tooDeep(req.body.parameters)) return bad(res, 'parameters nested too deeply (max 8 levels)');
    const tp = traceparentFrom(req);
    res.set('traceparent', tp);
    const raw = evaluate(req.body.parameters, req.ws.rules.get());
    const entry = req.ws.log.add({ id: raw.correlationId, requestedAt: new Date().toISOString(), source: 'console', traceparent: tp, endpointId: clip(req.body.endpointId || 'mock-transaction', 40), parameters: req.body.parameters, decisionResponse: raw, decision: raw.decision });
    res.json(entry);
  });
  api.get('/decisions', (req, res) => res.json({ decisions: req.ws.log.list() }));
  api.delete('/decisions', (req, res) => { req.ws.log.clear(); res.status(204).end(); });

  // The mock worker credentials, for pasting into a client. A mock credential for a mock server (see worker.js).
  api.get('/worker', (req, res) => res.json(req.ws.worker.credentials()));
  api.post('/worker/rotate', small, (req, res) => res.json(req.ws.worker.rotate()));

  api.use((req, res) => bad(res, 'no such endpoint', 404, 'not_found'));
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo(env)); }); // the header "Shelf" button
  app.use('/api', api);

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/|pingone\/|governance\/).*/, (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return bad(res, 'request too large', 413, 'too_large');
    if (err instanceof SyntaxError) return bad(res, 'invalid JSON');
    return res.status(500).json({ error: 'server_error', message: clip(err?.message) });
  });
  return app;
}
