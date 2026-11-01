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
