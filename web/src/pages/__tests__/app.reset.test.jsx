import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App.jsx";
import flow from "../../../../server/diagrams/mock-authorize-flow.json";

let requests;
let resetOk;
function fakeServer() {
  requests = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || "GET";
    requests.push(`${method} ${url}`);
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (url === "/api/reset") return resetOk ? ok({ ok: true, cleared: ["rules", "decisions", "tokens"], kept: ["worker credentials"] }) : { ok: false, status: 502, json: async () => ({}) };
    if (url === "/api/rules") return ok({ rules: { denyAmountUsd: 2000, stepUpAmountUsd: 500, consentTypes: [], denyTools: [], hitlTools: [] }, defaults: {}, edited: [] });
    if (url === "/api/info") return ok({ mode: "mock", source: "mock", realAvailable: false, realReason: "Live mode is not available: test.", simulated: true, live: false, liveMessage: "Live mode is not available: test." });
    if (url === "/api/mode") return { ok: false, status: 409, json: async () => ({ error: "real_not_available", message: "Live mode is not available: test.", source: "mock" }) };
    if (url === "/api/decisions") return ok({ decisions: [] });
    if (url.startsWith("/api/diagram")) return ok(flow);
    if (url === "/api/config") return ok({ endpoints: [{ id: "mock-transaction" }, { id: "mock-mcp" }], pingonePath: "/pingone" });
    if (url === "/api/worker") return ok({ clientId: "mock-worker", clientSecret: "s3cret-mock" });
    return ok({});
  });
}
beforeEach(() => { localStorage.clear(); window.location.hash = ""; resetOk = true; fakeServer(); });

describe("Reset (rule 3)", () => {
  it("is in the header and asks the server to reset, then says what it did and what it kept", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(requests).toContain("POST /api/reset");
    expect(await screen.findByText(/rules back to defaults, decisions cleared, issued tokens ended\. Worker credentials kept\./)).toBeInTheDocument();
  });

  it("says so when the server cannot be reached, instead of pretending it worked", async () => {
    resetOk = false;
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(await screen.findByText(/Reset failed: could not reach the server\./)).toBeInTheDocument();
  });

  it("remounts the page, so the diagram boxes (held in page state) start over", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "How it fits" }));
    const before = screen.getByRole("main").firstElementChild;
    await userEvent.click(screen.getByTestId("reset"));
    await screen.findByText(/Worker credentials kept/);
    expect(screen.getByRole("main").firstElementChild).not.toBe(before);
  });
});

describe("Simulation banner (rule 2)", () => {
  it("says it is simulated and names the mode, on every page", async () => {
    render(<App />);
    expect(await screen.findByRole("note")).toHaveTextContent(/^Simulated, mock mode\. Mock Authorize answers from rules on this machine/);
    for (const name of ["Try", "Decisions", "Connect", "How it fits", "Rules"]) {
      await userEvent.click(screen.getByRole("link", { name }));
      expect(screen.getByRole("note")).toHaveTextContent(/Simulated, mock mode/);
    }
  });
});

describe("Mock | Live mode dropdown (header, every page)", () => {
  it("is in the header on every page, mock by default, and shows the mode", async () => {
    render(<App />);
    for (const name of ["Rules", "Try", "Decisions", "Connect", "How it fits"]) {
      await userEvent.click(screen.getByRole("link", { name }));
      const select = screen.getByTestId("mode-select");
      expect(select).toHaveValue("mock");
      expect(within(select).getByRole("option", { name: "Real" })).toBeInTheDocument();
      expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
    }
  });

  it("refuses Real through POST /api/mode with the server's honest 409 reason and stays in mock; Mock clears the message", async () => {
    render(<App />);
    await screen.findByText(/Simulated, mock mode/);
    const select = screen.getByTestId("mode-select");
    expect(within(select).getByRole("option", { name: "Real" })).toBeDisabled(); // Real is unavailable
    fireEvent.change(select, { target: { value: "real" } });
    expect(requests).toContain('POST /api/mode');
    expect(await screen.findByText("Live mode is not available: test.")).toBeInTheDocument();
    expect(screen.getByTestId("live-note")).toHaveTextContent("Live mode is not available: test.");
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
    expect(select).toHaveValue("mock");
    fireEvent.change(select, { target: { value: "mock" } });
    expect(screen.getByTestId("live-note")).toBeEmptyDOMElement();
  });
});

describe("Presenter mode (rule 3)", () => {
  it("P toggles it, Esc leaves it, the banner stays, and the talk-track line for the page shows", async () => {
    render(<App />);
    await screen.findByRole("note");
    await userEvent.keyboard("p");
    expect(await screen.findByRole("complementary", { name: "Talk track" })).toHaveTextContent("Set the rules");
    expect(screen.getByRole("note")).toHaveTextContent(/Simulated, mock mode/);
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Talk track" })).not.toBeInTheDocument();
    await userEvent.keyboard("P");
    expect(screen.getByRole("complementary", { name: "Talk track" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Try" }));
    expect(screen.getByRole("complementary", { name: "Talk track" })).toHaveTextContent("Try a request");
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("ignores P typed in a field and P with Ctrl, Cmd or Alt held", async () => {
    render(<App />);
    await userEvent.click(await screen.findByLabelText(/Deny above/));
    await userEvent.keyboard("p");
    expect(screen.queryByRole("complementary", { name: "Talk track" })).not.toBeInTheDocument();
    document.activeElement.blur();
    for (const mod of ["Control", "Meta", "Alt"]) await userEvent.keyboard(`{${mod}>}p{/${mod}}`);
    expect(screen.queryByRole("complementary", { name: "Talk track" })).not.toBeInTheDocument();
  });

  it("Esc outside presenter mode does nothing", async () => {
    render(<App />);
    await screen.findByRole("note");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Talk track" })).not.toBeInTheDocument();
  });
});

describe("Landmarks and focus", () => {
  it("keeps one main landmark, and Reset leaves focus on the Reset button", async () => {
    render(<App />);
    expect(await screen.findAllByRole("main")).toHaveLength(1);
    const btn = screen.getByRole("button", { name: "Reset" });
    btn.focus();
    await userEvent.click(btn);
    await screen.findByText(/Worker credentials kept/);
    expect(btn).toHaveFocus();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});

describe("Default page", () => {
  it("opens on Rules when there is no hash, so the page is never blank", async () => {
    render(<App />);
    expect(await screen.findByLabelText(/Deny above/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rules" })).toHaveAttribute("aria-current", "page");
  });
});
