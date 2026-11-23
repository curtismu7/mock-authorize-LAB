import React, { useCallback, useEffect, useRef, useState } from "react";
import { Source, Verdict } from "../components/Verdict.jsx";
import Json from "../components/JsonPane.jsx";
import { del, get } from "../lib/api.js";
import { REQUEST_HOT, RESPONSE_HOT, verdictOf } from "../lib/verdict.js";

// Drag the divider to widen or narrow the decision list; the width persists.
function useSplitResize(ref, key) {
  const onHandleDown = useCallback((e) => {
    e.preventDefault();
    const grid = ref.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const move = (ev) => {
      ev.preventDefault();
      const w = Math.min(Math.max(ev.clientX - rect.left, 220), rect.width * 0.5);
      grid.style.setProperty("--list-w", `${w}px`);
    };
    const up = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        const w = parseFloat(getComputedStyle(grid).getPropertyValue("--list-w"));
        if (w) localStorage.setItem(key, String(w));
      } catch { /* none */ }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }, [ref, key]);
  return onHandleDown;
}

// Every decision this server made: from the Try page ("Console") and from clients calling the PingOne-shaped API ("API").
export default function Decisions() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);
  const splitRef = useRef(null);
  const onHandleDown = useSplitResize(splitRef, "ma.listW");
  useEffect(() => {
    try {
      const w = parseFloat(localStorage.getItem("ma.listW"));
      if (w && splitRef.current) splitRef.current.style.setProperty("--list-w", `${w}px`);
    } catch { /* none */ }
  }, []);
  const refresh = useCallback(async () => { const r = await get("/api/decisions"); if (r.ok) setItems(r.data.decisions); }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);
  const sel = items.find((d) => d.id === open) || items[0];

  return (
    <>
      <h2><span className="step-num" aria-hidden="true" data-n="3"></span>Decisions</h2>
      <p className="lede">Everything this server decided, newest first. Calls from other apps, such as the P1AZ Inspector in Live mode, show up here as API.</p>
      {/* ui-pattern: allow P9 no primary here: Decisions is a read-only log that refreshes itself every 3s; Refresh and Clear are maintenance, not the page action */}
      <div className="controls"><button type="button" onClick={refresh}>Refresh</button>{items.length > 0 && <button type="button" onClick={async () => { await del("/api/decisions"); refresh(); }}>Clear</button>}</div>
      {items.length === 0 ? <p className="muted">No decisions yet. Use the Try page, or point a client at this server (see Connect).</p> : (
        <div className="split" ref={splitRef}>
          <ul className="calls">
            {items.map((d) => (
              <li key={d.id}><button type="button" aria-current={sel?.id === d.id} onClick={() => setOpen(d.id)}>
                <Source source={d.source} /> <Verdict decision={verdictOf(d.decisionResponse)} />
                <span className="muted small">{d.endpointId} · {new Date(d.requestedAt).toLocaleTimeString()}</span>
              </button></li>
            ))}
          </ul>
          <div className="col-handle" role="separator" aria-orientation="vertical" aria-label="Resize decision list" onPointerDown={onHandleDown} />
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
