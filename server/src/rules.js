// The editable policy knobs. Effective rules = DEFAULT_RULES with the saved patch applied (rules.json, in the data dir).
// Ported in spirit from AI-DEMO2 demo_authz_server ruleStore.js (sparse overlay, validated writes, reset); the knobs are
// the ones the P1AZ Inspector Mock engine uses, so the same request gives the same answer in both.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_RULES = Object.freeze({
  denyAmountUsd: 2000, // a transaction above this is denied
  stepUpAmountUsd: 500, // a withdrawal at or above this needs step-up (strong ACR)
  consentTypes: ['transfer'], // transaction types that always need human consent
  denyTools: ['delete_account', 'export_all_data'], // MCP tools never allowed
  hitlTools: ['create_transfer', 'create_withdrawal'], // MCP tools that need a person's approval
});

const NUMBERS = ['denyAmountUsd', 'stepUpAmountUsd'];
const LISTS = ['consentTypes', 'denyTools', 'hitlTools'];

// Returns { rules } (a clean copy of the known keys) or { error }.
export function validate(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'rules must be a JSON object' };
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (NUMBERS.includes(k)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) return { error: `${k} must be a number from 0 to 1,000,000,000` };
      out[k] = v;
    } else if (LISTS.includes(k)) {
      if (!Array.isArray(v) || v.length > 100) return { error: `${k} must be a list of at most 100 names` };
      const names = v.map((x) => (typeof x === 'string' ? x.trim() : null));
      if (names.some((x) => !x || x.length > 100)) return { error: `${k} must hold non-empty names of at most 100 characters` };
      out[k] = [...new Set(names)];
    } else return { error: `unknown rule: ${k}` };
  }
  return { rules: out };
}

// dir null = memory only (tests).
export function createRuleStore({ dir }) {
  const file = dir ? path.join(dir, 'rules.json') : null;
  let overlay = {};
  try {
    if (file) { const { rules } = validate(JSON.parse(fs.readFileSync(file, 'utf8'))); if (rules) overlay = rules; }
  } catch { /* none yet, or unreadable: factory defaults */ }
  const save = () => {
    if (!file) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(overlay), { mode: 0o600 });
  };
  const get = () => ({ ...DEFAULT_RULES, ...overlay });
  return {
    get,
    overlay: () => ({ ...overlay }),
    update(patch) {
      const v = validate(patch);
      if (v.error) return v;
      overlay = { ...overlay, ...v.rules };
      // Only what differs from the defaults counts as edited; a value set back to its default is dropped.
      for (const k of Object.keys(overlay)) if (JSON.stringify(overlay[k]) === JSON.stringify(DEFAULT_RULES[k])) delete overlay[k];
      if (Object.keys(overlay).length) save(); else if (file) { try { fs.rmSync(file); } catch { /* none */ } }
      return { rules: get() };
    },
    reset() { overlay = {}; try { if (file) fs.rmSync(file); } catch { /* already gone */ } return get(); },
  };
}
