import React, { useCallback, useEffect, useState } from "react";
import { Source, Verdict } from "../components/Verdict.jsx";
import { del, get, pretty } from "../lib/api.js";
import { verdictOf } from "../lib/verdict.js";

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
              <h4>Request</h4><pre>{pretty({ parameters: sel.parameters })}</pre>
              <h4>Response</h4><pre>{pretty(sel.decisionResponse)}</pre>
            </>}
          </div>
        </div>
      )}
    </>
  );
}
