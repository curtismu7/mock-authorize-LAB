import React from "react";

// The verdict is always a word beside the colour.
const LABEL = { PERMIT: "Permit", DENY: "Deny", STEP_UP: "Step-up needed", CONSENT: "Consent needed", INDETERMINATE: "Could not evaluate" };
export function Verdict({ decision }) {
  const key = LABEL[decision] ? decision.toLowerCase() : "other";
  return <span className={`verdict verdict--${key}`}>{LABEL[decision] || decision || "No decision"}</span>;
}
export const Source = ({ source }) => <span className={`engine engine--${source === "api" ? "live" : "mock"}`}>{source === "api" ? "API" : "Console"}</span>;
