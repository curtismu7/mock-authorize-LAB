// The mock worker app: a client id and secret that the token endpoint accepts, so a client such as the P1AZ Inspector can
// run its real worker-token flow against this server. A MOCK credential for a MOCK server: the console shows it so you can
// paste it into the client. Stored in worker.json (mode 600). Issued tokens live in memory only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_TTL_S = 3600;
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// dir null = memory only (tests).
export function createWorker({ dir }) {
  const file = dir ? path.join(dir, 'worker.json') : null;
  let creds;
  try { creds = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { creds = null; }
  const save = () => { if (!file) return; fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(creds), { mode: 0o600 }); };
  const fresh = () => ({ clientId: 'mock-worker', clientSecret: crypto.randomBytes(24).toString('hex') });
  if (!creds?.clientId || !creds?.clientSecret) { creds = fresh(); save(); }
  const tokens = new Map(); // token -> expiresAt
  return {
    credentials: () => ({ ...creds }),
    rotate() { creds = fresh(); save(); tokens.clear(); return { ...creds }; },
    revokeTokens() { const n = tokens.size; tokens.clear(); return n; }, // Reset: end every issued token, keep the credentials
    checkClient: (id, secret) => same(id, creds.clientId) && same(secret, creds.clientSecret),
    issue() {
      const token = `mock-${crypto.randomBytes(24).toString('hex')}`;
      tokens.set(token, Date.now() + TOKEN_TTL_S * 1000);
      return { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_S };
    },
    validToken(token) { const exp = tokens.get(token); if (!exp) return false; if (exp < Date.now()) { tokens.delete(token); return false; } return true; },
    secrets: () => [creds.clientSecret, ...tokens.keys()],
  };
}
