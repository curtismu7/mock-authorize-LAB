import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "../diagram-kit/DiagramKit.jsx";
import { boxPassport, sidePoint } from "../diagram-kit/diagramKit.js";
import "../diagram-kit/diagram-kit.css";
import { get } from "../lib/api.js";

// The diagram is data: a diagram-studio/1 document the server loads by name (rule 17). This page only draws it. Boxes are
// draggable; Simulate walks the steps; Reset puts the boxes back; the speed control sets the pace.
// Diagram standard (§8c): the shared diagram kit draws the arrow labels (above the boxes, clear of each
// other) and a click expands a box in place with its passport.
const NAME = "mock-authorize-flow";
const BASE_MS = 1600;
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const stepNodes = (flow, step) => new Set(step.edges.flatMap((i) => [flow.edges[i].source, flow.edges[i].target]));

function Box({ data }) {
  return (
    <div className="fbox" data-color={data.color} data-on={data.on ? "true" : "false"} data-dim={data.dim ? "true" : "false"}>
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <span className="fbox__group">{data.group}</span>
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };
// The curve only: every label is drawn by the diagram kit's EdgeLabels, in a layer above the boxes.
const edgeTypes = { arrow: ArrowNoLabel };

export default function Diagram({ theme = "system" }) {
  const [flow, setFlow] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; // a late answer after the page was left is dropped
    get(`/api/diagram?name=${NAME}`).then((r) => { if (!live) return; if (r.ok) setFlow(r.data); else setFailed(true); });
    return () => { live = false; };
  }, []);
  if (failed) return <p className="alert" role="alert">Could not load the diagram.</p>;
  if (!flow) return <p className="muted">Loading the diagram…</p>;
  return <FlowView flow={flow} theme={theme} />;
}

function FlowView({ flow, theme }) {
  const start = useMemo(() => flow.nodes.map((n) => ({ id: n.id, position: { x: n.x, y: n.y }, data: { title: n.label, sub: n.sub.join(" "), group: flow.groups[n.group].label, color: flow.groups[n.group].color } })), [flow]);
  const edgeList = useMemo(() => flow.edges.map((e, i) => ({ id: `e${i}`, type: "arrow", source: e.source, target: e.target, sourceHandle: "r", targetHandle: "l" })), [flow]);
  const [moved, setMoved] = useState(start);
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  // Click a box and it expands in place with its details (the shared diagram kit's Passport, §8c).
  const [open, setOpen] = useState(null);
  const steps = flow.steps;

  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);

  // Run buttons use aria-disabled, not disabled, so focus stays where it is while a run is on.
  const simulate = () => { if (running) return; setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); setMoved(start); setOpen(null); };
  const onNodesChange = useCallback((c) => setMoved((n) => applyNodeChanges(c, n)), []);

  const cur = step >= 0 ? steps[step] : null;
  // The graph for the box passport (group, reach, arrows), built from the diagram data.
  const graph = useMemo(() => ({
    nodes: flow.nodes.map((n) => ({ id: n.id, label: n.label, sub: n.sub.join(" "), group: n.group })),
    edges: flow.edges.map((e) => ({ source: e.source, target: e.target, label: e.label ?? "" })),
    groups: flow.groups,
  }), [flow]);
  const lit = cur ? stepNodes(flow, cur) : null;
  const nodes = useMemo(() => moved.map((n) => ({
    ...n, type: "box", zIndex: n.id === open ? 10 : undefined,
    data: { ...n.data, on: !!lit?.has(n.id), dim: !!lit && !lit.has(n.id), passport: n.id === open ? boxPassport(graph, n.id) : null },
  })), [moved, lit, open, graph]);
  const edges = useMemo(() => edgeList.map((e, i) => ({ ...e, animated: !!cur?.edges.includes(i), className: cur?.edges.includes(i) ? "edge-on" : "", markerEnd: { type: MarkerType.ArrowClosed } })), [edgeList, cur]);
  // One label item per arrow, for the kit's EdgeLabels layer (above the boxes, never overlapping).
  const items = useMemo(() => flow.edges.map((e, i) => ({
    id: `e${i}`, text: e.label ?? "", source: e.source, target: e.target, sourceHandle: "r", targetHandle: "l",
    active: !!cur?.edges.includes(i), dim: !!cur && !cur.edges.includes(i),
  })), [flow, cur]);
  const actions = useMemo(() => ({
    open: (id) => setOpen(id), close: () => setOpen(null),
    link: (id) => { const u = new URL(window.location.href); u.searchParams.set("box", id); return u.toString(); },
  }), []);

  return (
    <>
      <h2>{flow.title}</h2>
      <p className="lede">{flow.lede}</p>
      <div className="card controls">
        <label>Speed<select value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <button type="button" className="primary" onClick={simulate} aria-disabled={running}>Simulate</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
      <div className="flow-wrap" role="group" aria-label={`Diagram: ${flow.title}. Boxes can be dragged.`}>
        <PassportActions.Provider value={actions}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} colorMode={theme}
            onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)}
            fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
            <Background />
            <Controls showInteractive={false} />
            <EdgeLabels items={items} pointFor={(box, handle) => sidePoint(box, String(handle))} fallback={{ w: 210, h: 80 }} />
            <FitOpen open={open} closePadding={0.12} />
          </ReactFlow>
        </PassportActions.Provider>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption">
        {cur ? `Step ${step + 1} of ${steps.length}: ${cur.title}. ${cur.what}` : "Press Simulate to walk one run through the diagram."}
      </p>
    </>
  );
}
