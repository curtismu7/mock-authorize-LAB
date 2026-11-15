// The answer is PingOne's: PERMIT or DENY plus statements. A gate (step-up, consent, human approval) is a PERMIT whose statement
// code names it, so the console shows it as its own verdict. Same reading as the P1AZ Inspector's Live mode.
const GATE = /step|consent|hitl|approv/i;
export function verdictOf(raw) {
  const effect = String(raw?.decision ?? raw?.result?.decision ?? "").toUpperCase();
  if (effect === "DENY") return "DENY";
  if (effect === "INDETERMINATE") return "INDETERMINATE";
  if (effect !== "PERMIT") return "DENY";
  const gate = (raw.statements || []).find((s) => GATE.test(`${s.code || ""} ${s.name || ""}`));
  if (!gate) return "PERMIT";
  return /step/i.test(`${gate.code} ${gate.name}`) ? "STEP_UP" : "CONSENT";
}

// The keys that matter in this lab's JSON panes, marked for JsonPane (`decision` is already stood out by default): what was asked, and the statements that explain the answer.
export const REQUEST_HOT = ["Amount", "TransactionType", "ToolName", "HitlApproved"];
export const RESPONSE_HOT = ["statements", "code"];
