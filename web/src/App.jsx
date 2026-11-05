import React, { useEffect, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import Connect from "./pages/Connect.jsx";
import Decisions from "./pages/Decisions.jsx";
import Diagram from "./pages/Diagram.jsx";
import Rules from "./pages/Rules.jsx";
import Try from "./pages/Try.jsx";
import { get, post } from "./lib/api.js";
import stories from "../../content/stories.json";

const PAGES = [["rules", "Rules"], ["try", "Try"], ["decisions", "Decisions"], ["connect", "Connect"], ["diagram", "How it fits"]];
// Presenter mode shows the talk-track line for the page. The lines are the stories in content/stories.json, the same data docs/talk-track.md is generated from.
const PRESENTER_STORY = { rules: "S01", try: "S02", decisions: "S03", connect: "S03", diagram: "S04" };
const LIVE_FALLBACK = "Live mode is not available: Mock Authorize is itself the mock server. It has no live backend and never calls PingOne. Use mock.";
const store = {
  read(k) { try { return localStorage.getItem(k); } catch { return null; } },
  write(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};

export default function App() {
  const [page, setPage] = useState(() => (PAGES.some(([id]) => id === window.location.hash.slice(1)) ? window.location.hash.slice(1) : "rules"));
  const [theme, setTheme] = useState(() => store.read("mockaz-theme") || "system");
  const [epoch, setEpoch] = useState(0); // bumped by Reset: remounts the pages, so the diagram boxes and form fields start over
  const [resetNote, setResetNote] = useState("");
  const [info, setInfo] = useState(null);
  const [liveNote, setLiveNote] = useState("");
  const [presenter, setPresenter] = useState(false);
  useEffect(() => { get("/api/info").then((r) => r.ok && setInfo(r.data)); }, []);
  const reset = async () => {
    const r = await post("/api/reset");
    setEpoch((n) => n + 1);
    setResetNote(r.ok ? "Reset: rules back to defaults, decisions cleared, issued tokens ended. Worker credentials kept." : "Reset failed: could not reach the server.");
  };
  // Mock is the only mode this app has. Pressing Live is refused with the reason, and the page stays in mock.
  const mode = info?.mode || "mock";
  const pickMode = (m) => setLiveNote(m === "live" ? (info?.liveMessage || LIVE_FALLBACK) : "");

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
    store.write("mockaz-theme", theme);
  }, [theme]);
  useEffect(() => { window.location.hash = page; }, [page]);
  // Back, Forward or a typed fragment switches the page too (review finding: it did not).
  useEffect(() => {
    const onHash = () => { const h = window.location.hash.slice(1); if (PAGES.some(([id]) => id === h)) setPage(h); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => { document.title = `${PAGES.find(([id]) => id === page)?.[1] || "Rules"} · Mock Authorize LAB`; }, [page]);
  // P toggles presenter mode and Esc leaves it. A key typed into a field, or pressed with Ctrl, Cmd or Alt, is not ours.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const say = stories.find((s) => s.id === PRESENTER_STORY[page]);
  return (
    <div className="app" data-presenter={presenter ? "on" : "off"}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <p className="banner" role="note" data-state="mock">
        Simulated, {mode} mode. Mock Authorize answers from rules on this machine. It is not PingOne, and nothing here reaches a real tenant. Its answer shapes are UNVERIFIED against PingOne.
      </p>
      <header className="top">
        <h1>Mock Authorize LAB</h1>
        <nav aria-label="Pages">
          {PAGES.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={page === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPage(id); }}>{label}</a>
          ))}
        </nav>
        <div className="top__tools">
            <ShelfLink />
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={mode === "mock"} onClick={() => pickMode("mock")}>Mock</button>
            <button type="button" aria-pressed={false} onClick={() => pickMode("live")}>Live</button>
          </div>
          <span className="chip" data-testid="mode">Mode: {mode}</span>
          <button type="button" onClick={reset}>Reset session</button>
          <button type="button" aria-pressed={presenter} onClick={() => setPresenter((v) => !v)}>{presenter ? "Exit presenter (Esc)" : "Presenter (P)"}</button>
          {!presenter && (
            <label className="theme">Theme
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
              </select>
            </label>
          )}
        </div>
      </header>
      <div role="status" data-testid="live-note">{liveNote && <p className="alert">{liveNote}</p>}</div>
      <p className="sr-only" role="status">{resetNote}</p>
      <main className="page" id="main" tabIndex={-1} key={epoch}>
        {presenter && say && <aside className="presenter-say" aria-label="Talk track"><p><strong>{say.title}.</strong> {say.say}</p></aside>}
        {page === "rules" && <Rules />}
        {page === "try" && <Try />}
        {page === "decisions" && <Decisions />}
        {page === "connect" && <Connect />}
        {page === "diagram" && <Diagram theme={theme} />}
      </main>
    </div>
  );
}
