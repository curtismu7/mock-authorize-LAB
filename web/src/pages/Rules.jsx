import React, { useEffect, useState } from "react";
import { api, get, post } from "../lib/api.js";

// The editable policy. Numbers are dollar limits; lists are one name per line. Saved rules change the very next decision,
// from the console and from any client calling the PingOne-shaped API.
const NUMBERS = [
  ["denyAmountUsd", "Deny above (USD)", "A transaction above this amount is denied."],
  ["stepUpAmountUsd", "Step-up from (USD)", "A withdrawal at or above this needs a strong sign-in (MFA)."],
];
const LISTS = [
  ["consentTypes", "Always need consent: transaction types", "One per line, for example transfer."],
  ["denyTools", "Never allowed: MCP tools", "One per line."],
  ["hitlTools", "Need a person's approval: MCP tools", "One per line. HitlApproved:true clears it."],
];
const toText = (r) => ({ ...Object.fromEntries(NUMBERS.map(([k]) => [k, String(r[k])])), ...Object.fromEntries(LISTS.map(([k]) => [k, r[k].join("\n")])) });

export default function Rules() {
  const [state, setState] = useState(null); // { rules, defaults, edited }
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = (d) => { setState(d); setForm(toText(d.rules)); };
  useEffect(() => { get("/api/rules").then((r) => { if (r.ok) load(r.data); }); }, []);
  if (!form) return <p className="muted">Loading the rules…</p>;

  async function save(e) {
    e.preventDefault();
    const body = {};
    for (const [k] of NUMBERS) body[k] = Number(form[k]);
    for (const [k] of LISTS) body[k] = form[k].split("\n").map((x) => x.trim()).filter(Boolean);
    const r = await api("PUT", "/api/rules", body);
    if (r.ok) { load(r.data); setMsg({ ok: true, text: "Saved. The next decision uses these rules." }); } else setMsg({ ok: false, text: r.data?.message || "Could not save." });
  }
  async function reset() {
    const r = await post("/api/rules/reset");
    if (r.ok) { load(r.data); setMsg({ ok: true, text: "Back to the default rules." }); }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const edited = (k) => state.edited.includes(k);

  return (
    <>
      <h2>Rules</h2>
      <p className="lede">The policy this server decides by. Change a rule, save, and the very next decision follows it, whether it comes from the Try page or from a client calling the PingOne-shaped API.</p>
      <form className="card" onSubmit={save}>
        <div className="fields">
          {NUMBERS.map(([k, label, hint]) => (
            <label key={k}>{label}{edited(k) && <span className="engine engine--mock"> edited</span>}
              <input type="number" min="0" value={form[k]} onChange={set(k)} />
              <span className="muted small">{hint} Default {state.defaults[k]}.</span>
            </label>
          ))}
        </div>
        <div className="fields">
          {LISTS.map(([k, label, hint]) => (
            <label key={k}>{label}{edited(k) && <span className="engine engine--mock"> edited</span>}
              <textarea rows={4} value={form[k]} onChange={set(k)} />
              <span className="muted small">{hint}</span>
            </label>
          ))}
        </div>
        <div className="controls">
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={() => state.edited.length > 0 && reset()} aria-disabled={state.edited.length === 0}>Reset to defaults</button>
        </div>
        {msg && <p className={msg.ok ? "ok" : "alert"} role="status">{msg.text}</p>}
      </form>
    </>
  );
}
