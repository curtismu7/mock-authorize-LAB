// The PingOne-shaped surface. A client points its PingOne base URL at <this server>/pingone and runs its normal flow:
//   POST /pingone/auth/{env}/as/token                                      client credentials (Basic), like auth.pingone.com
//   GET  /pingone/api/v1/environments/{env}/decisionEndpoints              list (Bearer)
//   POST /pingone/api/v1/environments/{env}/decisionEndpoints/{id}         {parameters} -> decision (Bearer)
//   GET  /pingone/api/v1/environments/{env}/decisionEndpoints/{id}/recentDecisions
// The paths mirror PingOne's auth host ({env}/as/token) and API host (v1/environments/{env}/...), with /pingone/auth and /pingone/api
// standing in for the two hosts. The environment id is accepted as given (any UUID-ish value).
import express from 'express';
import { evaluate } from './engine.js';
import { tooDeep, traceparentFrom } from './limits.js';

export const ENDPOINTS = [
  { id: 'mock-transaction', name: 'Mock transaction decisions', recordRecentRequests: true },
  { id: 'mock-mcp', name: 'Mock MCP tool decisions', recordRecentRequests: true },
];

const problem = (res, status, code, message) => res.status(status).json({ code, message });

// The on-prem PingAuthorize decision call, as AI-DEMO2's gateway and its own mock make it. No token: an on-prem PingAuthorize
// in Docker is reached directly. Mounted at the server root (not under /pingone) so a client's URL is just the server's base URL on port 4850.
export function createPingAuthorizeRouter({ workspaces }) {
  const router = express.Router();
  router.post('/governance/pap/alpha/policy/:policyId/decision', express.json({ limit: '256kb' }), (req, res) => {
    const parameters = req.body?.parameters;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return problem(res, 400, 'INVALID_REQUEST', 'parameters must be an object.');
    if (tooDeep(parameters)) return problem(res, 400, 'INVALID_REQUEST', 'parameters nested too deeply (max 8 levels).');
    const tp = traceparentFrom(req);
    res.set('traceparent', tp);
    const ws = workspaces.forRequest(req, res);
    const raw = evaluate(parameters, ws.rules.get());
    ws.log.add({ id: raw.correlationId, requestedAt: new Date().toISOString(), source: 'api', traceparent: tp, endpointId: req.params.policyId, parameters, decisionResponse: raw, decision: raw.decision });
    return res.json(raw);
  });
  return router;
}

export function createPingoneRouter({ workspaces }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.post('/auth/:env/as/token', express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => {
    const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
    const [id, ...rest] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [];
    const worker = workspaces.forClient(id || '')?.worker;
    if (!worker || !worker.checkClient(id || '', rest.join(':'))) return res.status(401).json({ error: 'invalid_client', error_description: 'Request denied: Invalid client credentials' });
    if (req.body?.grant_type !== 'client_credentials') return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported' });
    return res.json(worker.issue());
  });

  const api = express.Router({ mergeParams: true });
  api.use((req, res, next) => {
    const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
    const ws = m ? workspaces.forToken(m[1]) : undefined;
    if (!ws || !ws.worker.validToken(m[1])) return problem(res, 401, 'UNAUTHORIZED', 'The request could not be authenticated. Get a worker token first.');
    req.ws = ws;
    return next();
  });
  api.get('/decisionEndpoints', (_req, res) => res.json({ _embedded: { decisionEndpoints: ENDPOINTS }, count: ENDPOINTS.length }));
  api.post('/decisionEndpoints/:id', express.json({ limit: '256kb' }), (req, res) => {
    if (!ENDPOINTS.some((e) => e.id === req.params.id)) return problem(res, 404, 'NOT_FOUND', 'Decision endpoint not found.');
    const parameters = req.body?.parameters;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return problem(res, 400, 'INVALID_REQUEST', 'parameters must be an object.');
    if (tooDeep(parameters)) return problem(res, 400, 'INVALID_REQUEST', 'parameters nested too deeply (max 8 levels).');
    const tp = traceparentFrom(req);
    res.set('traceparent', tp);
    const raw = evaluate(parameters, req.ws.rules.get());
    req.ws.log.add({ id: raw.correlationId, requestedAt: new Date().toISOString(), source: 'api', traceparent: tp, endpointId: req.params.id, parameters, decisionResponse: raw, decision: raw.decision });
    return res.json(raw);
  });
  api.get('/decisionEndpoints/:id/recentDecisions', (req, res) => {
    if (!ENDPOINTS.some((e) => e.id === req.params.id)) return problem(res, 404, 'NOT_FOUND', 'Decision endpoint not found.');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 20);
    const recent = req.ws.log.list().filter((d) => d.endpointId === req.params.id).slice(0, limit)
      .map((d) => ({ id: d.id, requestedAt: d.requestedAt, decision: d.decision, decisionResponse: d.decisionResponse }));
    return res.json({ _embedded: { recentDecisions: recent }, count: recent.length });
  });
  router.use('/api/v1/environments/:env', api);
  return router;
}
