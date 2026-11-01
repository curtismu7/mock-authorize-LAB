// Answers a decision request the way PingOne Authorize's decision endpoint does, from the editable rules.
// The answer is PingOne's real shape (see AI-DEMO2 pingOneAuthorizeService _rawEffect / _mapDecisionFields): `decision`,
// `statements[{code,name,statement}]`, `correlationId`, `elapsedMicroseconds`. A gate (step-up, consent, human approval) is
// a PERMIT plus a statement whose code names it, which is how the real endpoint signals it. A request with nothing the
// rules can read is INDETERMINATE (PingOne's "could not evaluate"), never a silent permit.
import crypto from 'node:crypto';

const STRONG_ACR = /(mfa|multi_factor|2fa|step|high|aal2|aal3|urn:.*:(loa|aal)[23])/i;
const st = (code, name, statement) => ({ code, name, statement });
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function decide(p, rules) {
  const isMcp = p.DecisionContext === 'McpFirstTool' || p.DecisionContext === 'McpToolCall' || p.ToolName;
  if (isMcp) {
    const tool = String(p.ToolName || '');
    if (!tool) return { decision: 'INDETERMINATE', statements: [st('attribute-missing', 'Attribute missing', 'The request names no ToolName.')] };
    if (rules.denyTools.includes(tool)) return { decision: 'DENY', statements: [st('tool-denied', 'Tool blocked', `${tool} is on the deny list.`)] };
    if (rules.hitlTools.includes(tool) && !(p.HitlApproved === true || p.HitlApproved === 'true')) {
      return { decision: 'PERMIT', statements: [st('HITL_CONSENT', 'Human approval', `${tool} needs a person to approve it first.`)] };
    }
    const amount = num(p.Amount ?? p.TransactionAmount);
    if (amount > rules.denyAmountUsd) return { decision: 'DENY', statements: [st('transaction-denied', 'Over the limit', `Amount ${amount} is above ${rules.denyAmountUsd}.`)] };
    return { decision: 'PERMIT', statements: [st('permit', 'Allowed', `${tool} may run for ${p.UserId || 'this user'}.`)] };
  }
  const given = p.Amount ?? p.TransactionAmount;
  if (given == null || given === '' || !p.TransactionType) {
    return { decision: 'INDETERMINATE', statements: [st('attribute-missing', 'Attribute missing', 'Send Amount and TransactionType (or a ToolName).')] };
  }
  const amount = num(given);
  const type = String(p.TransactionType).toLowerCase();
  if (amount > rules.denyAmountUsd) return { decision: 'DENY', statements: [st('transaction-denied', 'Over the limit', `Amount ${amount} is above ${rules.denyAmountUsd}.`)] };
  if (type === 'withdrawal' && amount >= rules.stepUpAmountUsd && !STRONG_ACR.test(String(p.Acr || ''))) {
    return { decision: 'PERMIT', statements: [st('STEP_UP_MFA', 'Stronger sign-in needed', `Withdrawals of ${rules.stepUpAmountUsd} or more need MFA.`)] };
  }
  if (rules.consentTypes.includes(type)) {
    return { decision: 'PERMIT', statements: [st('HITL_CONSENT', 'Consent needed', `A ${type} always needs the person's consent.`)] };
  }
  return { decision: 'PERMIT', statements: [st('permit', 'Allowed', `${type} of ${amount} is within policy.`)] };
}

export function evaluate(parameters, rules) {
  const started = process.hrtime.bigint();
  const d = decide(parameters && typeof parameters === 'object' ? parameters : {}, rules);
  return {
    correlationId: crypto.randomUUID(),
    decision: d.decision,
    statements: d.statements,
    elapsedMicroseconds: Number((process.hrtime.bigint() - started) / 1000n),
  };
}
