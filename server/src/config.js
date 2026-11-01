import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 4850;

export function dataDir(env = process.env) { return env.DATA_DIR || path.join(os.homedir(), '.mock-authorize'); }
export function port(env = process.env) { return Number(env.PORT) || DEFAULT_PORT; }

// MOCKAZ_LAB_MODE is the one key this app reads from the shared settings file. This app IS the mock server: it has no live mode,
// so mock is the only value. Live is refused with an honest message, never a silent fallback. A bare MODE is never read.
export const MODES = ['mock'];
export const LIVE_REFUSAL = 'Live mode is not available: Mock Authorize is itself the mock server. It has no live backend and never calls PingOne. Use mock.';
export function modeFrom(env = process.env) {
  const raw = env.MOCKAZ_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (m === 'live') throw new Error(LIVE_REFUSAL);
  if (!MODES.includes(m)) throw new Error(`MOCKAZ_LAB_MODE=${String(m).slice(0, 20)} is not a mode this app has (only mock)`);
  return m;
}
