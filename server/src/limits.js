// Limits shared by the console and the PingOne-shaped API. Nesting is counted without recursion, so a hostile body cannot
// overflow the stack or poison the decision log (review finding: 10000-deep input gave a 500 and broke /api/decisions).
// The traceparent is the W3C header (rule 14): an incoming valid one is kept, otherwise one is made, and it is returned and recorded.
import crypto from 'node:crypto';

export const MAX_DEPTH = 8;

export function tooDeep(value) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > MAX_DEPTH) return true;
    if (v && typeof v === 'object') for (const x of Object.values(v)) stack.push([x, d + 1]);
  }
  return false;
}

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
export function traceparentFrom(req) {
  const h = req.headers.traceparent;
  return typeof h === 'string' && TRACEPARENT.test(h) ? h : `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`;
}
