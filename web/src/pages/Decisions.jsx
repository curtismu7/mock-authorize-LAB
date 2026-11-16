import React, { useCallback, useEffect, useState } from "react";
import { Source, Verdict } from "../components/Verdict.jsx";
import Json from "../components/JsonPane.jsx";
import { del, get } from "../lib/api.js";
import { REQUEST_HOT, RESPONSE_HOT, verdictOf } from "../lib/verdict.js";

// Every decision this server made: from the Try page ("Console") and from clients calling the PingOne-shaped API ("API").
export default function Decisions() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);
  const refresh = useCallback(async () => { const r = await get("/api/decisions"); if (r.ok) setItems(r.data.decisions); }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);
  const sel = items.find((d) => d.id === open) || items[0];

  return (
    <>
      <h2>Decisions</h2>
      <p className="lede">Everything this server decided, newest first. Calls from other apps, such as the P1AZ Inspector in Live mode, show up here as API.</p>
      {/* ui-pattern: allow P9 no primary here: Decisions is a read-only log that refreshes itself every 3s; Refresh and Clear are maintenance, not the page action */}
      <div className="controls"><button type="button" onClick={refresh}>Refresh</button>{items.length > 0 && <button type="button" onClick={async () => { await del("/api/decisions"); refresh(); }}>Clear</button>}</div>
      {items.length === 0 ? <p className="muted">No decisions yet. Use the Try page, or point a client at this server (see Connect).</p> : (
        <div className="split">
          <ul className="calls">
            {items.map((d) => (
              <li key={d.id}><button type="button" aria-current={sel?.id === d.id} onClick={() => setOpen(d.id)}>
                <Source source={d.source} /> <Verdict decision={verdictOf(d.decisionResponse)} />
                <span className="muted small">{d.endpointId} · {new Date(d.requestedAt).toLocaleTimeString()}</span>
              </button></li>
            ))}
          </ul>
          <div className="card" data-testid="decision-detail">
            {sel && <>
              <h3><Verdict decision={verdictOf(sel.decisionResponse)} /> <Source source={sel.source} /></h3>
              <h4>Request</h4><Json value={{ parameters: sel.parameters }} label="Decision request" testId="decision-request" hot={REQUEST_HOT} />
              <h4>Response</h4><Json value={sel.decisionResponse} label="Decision response" testId="decision-response" hot={RESPONSE_HOT} />
            </>}
          </div>
        </div>
      )}
    </>
  );
}
