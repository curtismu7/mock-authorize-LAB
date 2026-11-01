// One workspace, "default": the rules, the mock worker credentials and the decision log of this machine, backed by the files in
// DATA_DIR (rules.json, worker.json). Console routes read req.ws; the PingOne-shaped routes find it by client id or token.
import { createDecisionLog } from './decisions.js';
import { createRuleStore } from './rules.js';
import { createWorker } from './worker.js';

export function createWorkspaces({ rules, worker, log, dir } = {}) {
  const only = { id: 'default', rules: rules || createRuleStore({ dir }), worker: worker || createWorker({ dir }), log: log || createDecisionLog() };
  return { forRequest: () => only, forClient: () => only, forToken: () => only };
}
