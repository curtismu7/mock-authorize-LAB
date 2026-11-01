import React, { useState } from "react";
import { Verdict } from "../components/Verdict.jsx";
import { post, pretty } from "../lib/api.js";
import { verdictOf } from "../lib/verdict.js";

// Ask for a decision from the console. No token: this is the quick way to see a rule at work. It is logged like any other call.
const PRESETS = [["transaction", "Transaction"], ["mcp", "MCP tool"], ["custom", "Custom (JSON)"]];

export function buildParameters(preset, f) {
  if (preset === "transaction") return { Amount: Number(f.amount) || 0, TransactionType: f.txType, Acr: f.acr, UserId: f.userId };
  if (preset === "mcp") return { DecisionContext: "McpToolCall", ToolName: f.toolName, HitlApproved: f.hitl, UserId: f.userId };
  return JSON.parse(f.json);
}

export default function Try() {
  const [preset, setPreset] = useState("transaction");
  const [f, setF] = useState({ amount: "500", txType: "transfer", acr: "", userId: "demoUser", toolName: "create_transfer", hitl: false, json: '{\n  "Amount": 100,\n  "TransactionType": "deposit"\n}' });
  const [out, setOut] = useState(null);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function send() {
    setError("");
    let parameters;
    try { parameters = buildParameters(preset, f); } catch { setError("The custom request is not valid JSON."); return; }
    const r = await post("/api/try", { parameters, endpointId: preset === "mcp" ? "mock-mcp" : "mock-transaction" });
    if (r.ok) setOut({ ...r.data, parameters }); else setError(r.data?.message || "The call failed.");
  }
  const raw = out?.decisionResponse;

  return (
    <>
      <h2>Try a decision</h2>
      <p className="lede">Send a request and see the verdict, the statements, and PingOne's answer shape. Edit the rules first to watch the answer change.</p>
      <div className="card">
        <div className="seg" role="group" aria-label="Decision type">
          {PRESETS.map(([id, label]) => <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)}>{label}</button>)}
        </div>
        <div className="fields">
          {preset === "transaction" && <>
            <label>Amount<input value={f.amount} onChange={set("amount")} /></label>
            <label>Type<select value={f.txType} onChange={set("txType")}>{["transfer", "withdrawal", "deposit", "payment"].map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>ACR<input value={f.acr} onChange={set("acr")} /></label>
          </>}
          {preset === "mcp" && <>
            <label>Tool name<input value={f.toolName} onChange={set("toolName")} /></label>
            <label className="check"><input type="checkbox" checked={f.hitl} onChange={set("hitl")} /> HITL approved</label>
          </>}
          {preset === "custom" && <label>Request parameters<textarea rows={6} value={f.json} onChange={set("json")} /></label>}
          {preset !== "custom" && <label>User ID<input value={f.userId} onChange={set("userId")} /></label>}
        </div>
        <button type="button" className="primary" onClick={send}>Send</button>
        {error && <p className="alert" role="alert">{error}</p>}
      </div>
      {out && (
        <div className="card" data-testid="result">
          <h3><Verdict decision={verdictOf(raw)} /></h3>
          <p className="muted small">{raw.elapsedMicroseconds} µs · correlation <code>{raw.correlationId}</code></p>
          <h4>Statements</h4>
          <ul className="stmts">{raw.statements.map((s, i) => <li key={i}><strong>{s.name}</strong> <code>{s.code}</code>{s.statement ? `: ${s.statement}` : ""}</li>)}</ul>
          <h4>Request</h4><pre>{pretty({ parameters: out.parameters })}</pre>
          <h4>Response</h4><pre>{pretty(raw)}</pre>
        </div>
      )}
    </>
  );
}
