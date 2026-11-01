// The decision log: every decision this server made, newest first, from the console and from the PingOne-shaped API.
// In memory, this run only. The PingOne-shaped recentDecisions endpoint reads it.
const MAX = 200;
// Per log, in bytes: each entry can carry a 256 KB request, so the count alone is not a memory bound. Hosted, many workspaces share one pod.
export const MAX_BYTES = 256 * 1024;

export function createDecisionLog() {
  const items = []; // newest first
  const sizes = new Map(); // entry -> bytes
  let bytes = 0;
  const drop = () => { const e = items.pop(); bytes -= sizes.get(e) || 0; sizes.delete(e); };
  return {
    add(entry) {
      const n = Buffer.byteLength(JSON.stringify(entry) || '');
      items.unshift(entry); sizes.set(entry, n); bytes += n;
      while (items.length > MAX || (bytes > MAX_BYTES && items.length > 1)) drop();
      return entry;
    },
    list: (limit = MAX) => items.slice(0, limit),
    bytes: () => bytes,
    clear() { items.length = 0; sizes.clear(); bytes = 0; },
  };
}
