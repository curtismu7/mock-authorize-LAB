// Request guards for a tool that connects to servers the operator names.
//  1. Bind loopback only, unless MOCKAZ_BIND is set (an explicit opt-in).
//  2. Reject any request whose Host header is not a loopback name (DNS-rebinding guard), unless it is the MOCKAZ_BIND address
//     or a LAB_ALLOWED_HOSTS name with this lab's port (the family lab-proxy's name for this app).
//  3. Every state-changing API call (anything but GET/HEAD) must carry an Origin whose host is exactly the Host header, or,
//     on a LAB_ALLOWED_HOSTS Host only, the lab-proxy's forwarded origin (X-Forwarded-Proto://X-Forwarded-Host).
// Loopback helper adapted from hostile-mcp server/src/safety.js (MIT, same author).
import { port as configPort } from './config.js';

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.MOCKAZ_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.MOCKAZ_BIND) return host;
  throw new Error(`refusing to bind ${host}: this tool connects to servers you name and listens on loopback only. Set MOCKAZ_BIND to opt in.`);
}

// "host:port" or "[::1]:port" or "host" -> bare host name.
function hostName(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

export function allowedHostNames(env = process.env) {
  const extra = [];
  if (env.MOCKAZ_BIND && env.MOCKAZ_BIND !== '0.0.0.0' && env.MOCKAZ_BIND !== '::') extra.push(env.MOCKAZ_BIND.toLowerCase());
  return extra;
}

// LAB_ALLOWED_HOSTS: comma-separated host names (no port) the family lab-proxy sends in Host. Unset = loopback only.
// Parsed once, before the server starts; a malformed entry stops the start.
export function parseAllowedHosts(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const n of names) if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(n)) throw new Error(`LAB_ALLOWED_HOSTS: "${n.slice(0, 40)}" is not a host name`);
  return new Set(names);
}
// The Hosts that may carry the lab-proxy's forwarded origin: each allowed name with this lab's port. Never loopback.
export const proxyHostSet = (allowed = new Set(), port = configPort({})) => new Set([...allowed].map((n) => `${n}:${port}`));

// Behind the lab-proxy the browser's Origin is the proxy's (https://local.ping-devops.com:8443) while Host is this lab's
// allowed name. X-Forwarded-Host/-Proto are believed only on such a Host, so a request on any other Host cannot use them.
export function isProxiedSameOrigin(headers, proxyHosts) {
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return proxyHosts.has(String(headers.host || '').toLowerCase()) && xfh !== '' && (xfp === 'https' || xfp === 'http') && headers.origin === `${xfp}://${xfh}`;
}

export function hostCheck(env = process.env, { allowedHosts = parseAllowedHosts(env), port = configPort(env) } = {}) {
  const allowed = new Set(allowedHostNames(env));
  const proxyHosts = proxyHostSet(allowedHosts, port);
  return (req, res, next) => {
    const name = hostName(req.headers.host);
    if (name && (isLoopbackHost(name) || allowed.has(name) || proxyHosts.has(String(req.headers.host).toLowerCase()))) return next();
    return res.status(403).json({ error: 'bad_host', message: 'This tool answers only to a loopback Host header. Use 127.0.0.1 or localhost.' });
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export function sameOriginWrites({ allowedHosts = new Set(), port = configPort({}) } = {}) {
  const proxyHosts = proxyHostSet(allowedHosts, port);
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.headers.origin;
    let ok = false;
    try { ok = Boolean(origin) && new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { ok = false; }
    if (!ok && !isProxiedSameOrigin(req.headers, proxyHosts)) return res.status(403).json({ error: 'cross_origin', message: 'State-changing calls must come from this tool\'s own page (Origin must match Host).' });
    return next();
  };
}
