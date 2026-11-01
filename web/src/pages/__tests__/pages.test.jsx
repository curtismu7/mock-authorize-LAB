import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Connect from "../Connect.jsx";
import Decisions from "../Decisions.jsx";
import Diagram from "../Diagram.jsx";
import Rules from "../Rules.jsx";
import Try, { buildParameters } from "../Try.jsx";
import { verdictOf } from "../../lib/verdict.js";
import flow from "../../../../server/diagrams/mock-authorize-flow.json";

const DEFAULTS = { denyAmountUsd: 2000, stepUpAmountUsd: 500, consentTypes: ["transfer"], denyTools: ["delete_account"], hitlTools: ["create_transfer"] };
let calls; let rules; let edited; let decisions;
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  calls = []; rules = { ...DEFAULTS }; edited = []; decisions = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || "GET"; const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key: `${method} ${url}`, body });
    if (url === "/api/rules" && method === "GET") return ok({ rules, defaults: DEFAULTS, edited });
    if (url === "/api/rules" && method === "PUT") { rules = { ...rules, ...body }; edited = Object.keys(body); return ok({ rules, defaults: DEFAULTS, edited }); }
    if (url === "/api/rules/reset") { rules = { ...DEFAULTS }; edited = []; return ok({ rules, defaults: DEFAULTS, edited }); }
    if (url === "/api/try") {
      const raw = { correlationId: "c1", decision: "PERMIT", statements: [{ code: "HITL_CONSENT", name: "Consent needed", statement: "needs consent" }], elapsedMicroseconds: 12 };
      return ok({ id: "c1", source: "console", endpointId: body.endpointId, parameters: body.parameters, decisionResponse: raw, requestedAt: "2026-10-21T10:00:00Z" });
    }
    if (url === "/api/decisions") return ok({ decisions });
    if (url === "/api/worker") return ok({ clientId: "mock-worker", clientSecret: "s3cret-mock" });
    if (url.startsWith("/api/diagram")) return ok(flow);
    if (url === "/api/config") return ok({ endpoints: [{ id: "mock-transaction" }, { id: "mock-mcp" }], pingonePath: "/pingone" });
    return { ok: false, status: 404, json: async () => ({ message: "no route" }) };
  });
});

describe("verdictOf", () => {
  it("reads PingOne's shape: gates are PERMIT plus a statement code", () => {
    expect(verdictOf({ decision: "DENY" })).toBe("DENY");
    expect(verdictOf({ decision: "PERMIT", statements: [{ code: "permit" }] })).toBe("PERMIT");
    expect(verdictOf({ decision: "PERMIT", statements: [{ code: "STEP_UP_MFA" }] })).toBe("STEP_UP");
    expect(verdictOf({ decision: "PERMIT", statements: [{ code: "HITL_CONSENT" }] })).toBe("CONSENT");
    expect(verdictOf({ decision: "INDETERMINATE" })).toBe("INDETERMINATE");
    expect(verdictOf({})).toBe("DENY");
  });
});

describe("Rules (aria-disabled)", () => {
  it("Reset to defaults is aria-disabled, not disabled, when nothing is edited, and does nothing then", async () => {
    render(<Rules />);
    const btn = await screen.findByRole("button", { name: "Reset to defaults" });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(btn);
    expect(calls.some((c) => c.key === "POST /api/rules/reset")).toBe(false);
  });
});

describe("Rules", () => {
  it("saves edited rules (numbers and one-per-line lists) and can reset", async () => {
    render(<Rules />);
    const deny = await screen.findByLabelText(/Deny above/);
    await userEvent.clear(deny); await userEvent.type(deny, "9000");
    const tools = screen.getByLabelText(/Never allowed/);
    await userEvent.clear(tools); await userEvent.type(tools, "wipe_all{enter}drop_db");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Saved\./);
    expect(calls.find((c) => c.key === "PUT /api/rules").body).toMatchObject({ denyAmountUsd: 9000, denyTools: ["wipe_all", "drop_db"] });
    expect(screen.getAllByText("edited").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    await screen.findByText(/Back to the default rules/);
    expect(screen.getByLabelText(/Deny above/)).toHaveValue(2000);
  });
});

describe("Try", () => {
  it("sends a transaction and shows the verdict word, statements and PingOne's response", async () => {
    render(<Try />);
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const result = await screen.findByTestId("result");
    expect(result).toHaveTextContent("Consent needed");
    expect(result).toHaveTextContent("HITL_CONSENT");
    expect(calls.find((c) => c.key === "POST /api/try").body).toMatchObject({ endpointId: "mock-transaction", parameters: { Amount: 500, TransactionType: "transfer" } });
  });
  it("custom JSON that is not valid is refused before any call", async () => {
    render(<Try />);
    await userEvent.click(screen.getByRole("button", { name: "Custom (JSON)" }));
    await userEvent.clear(screen.getByLabelText("Request parameters"));
    await userEvent.type(screen.getByLabelText("Request parameters"), "not json");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not valid JSON");
    expect(calls.some((c) => c.key === "POST /api/try")).toBe(false);
  });
  it("builds the three shapes", () => {
    const f = { amount: "42", txType: "withdrawal", acr: "mfa", userId: "u", toolName: "t", hitl: true, json: '{"A":1}' };
    expect(buildParameters("transaction", f)).toEqual({ Amount: 42, TransactionType: "withdrawal", Acr: "mfa", UserId: "u" });
    expect(buildParameters("mcp", f)).toMatchObject({ DecisionContext: "McpToolCall", ToolName: "t", HitlApproved: true });
    expect(buildParameters("custom", f)).toEqual({ A: 1 });
  });
});

describe("Decisions", () => {
  it("labels where each decision came from", async () => {
    decisions = [
      { id: "a", source: "api", endpointId: "mock-transaction", requestedAt: "2026-10-21T10:00:02Z", parameters: { Amount: 1 }, decisionResponse: { decision: "DENY", statements: [] } },
      { id: "b", source: "console", endpointId: "mock-mcp", requestedAt: "2026-10-21T10:00:01Z", parameters: {}, decisionResponse: { decision: "PERMIT", statements: [] } },
    ];
    render(<Decisions />);
    expect((await screen.findAllByText("API")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Console").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deny").length).toBeGreaterThan(0);
  });
  it("says what to do when there are none", async () => {
    render(<Decisions />);
    expect(await screen.findByText(/No decisions yet/)).toBeInTheDocument();
  });
});

describe("Connect", () => {
  it("shows the base URL, worker credentials and endpoints to paste into a client", async () => {
    render(<Connect />);
    await waitFor(() => expect(screen.getByText("mock-worker")).toBeInTheDocument());
    expect(screen.getByText("s3cret-mock")).toBeInTheDocument();
    expect(screen.getByText(/mock-transaction or mock-mcp/)).toBeInTheDocument();
    expect(screen.getByText(/\/pingone\/auth\/\{env\}\/as\/token/)).toBeInTheDocument();
    expect(screen.getByText(/As an on-prem PingAuthorize/)).toBeInTheDocument();
  });
});

describe("Diagram", () => {
  it("draws the diagram from its data (loaded by name from the server): title, lede and step count", async () => {
    render(<Diagram />);
    expect(await screen.findByRole("heading", { name: flow.title })).toBeInTheDocument();
    expect(calls.some((c) => c.key === "GET /api/diagram?name=mock-authorize-flow")).toBe(true);
    expect(screen.getByText(flow.lede)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(screen.getByTestId("caption")).toHaveTextContent(`of ${flow.steps.length}`);
  });
  it("Simulate walks steps with a caption, and Reset clears it", async () => {
    render(<Diagram />);
    await userEvent.click(await screen.findByRole("button", { name: "Simulate" }));
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 1 of 4/);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("caption")).toHaveTextContent("Press Simulate");
  });
  it("Simulate is aria-disabled, not disabled, while a run is on: focus stays and a second press does nothing", async () => {
    render(<Diagram />);
    const sim = await screen.findByRole("button", { name: "Simulate" });
    expect(sim).not.toBeDisabled();
    expect(sim).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(sim);
    expect(sim).toHaveAttribute("aria-disabled", "true");
    expect(sim).not.toBeDisabled();
    expect(sim).toHaveFocus();
    await userEvent.click(sim);
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 1 of 4/);
  });
  it("says so when the diagram cannot be loaded", async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => (url.startsWith("/api/diagram") ? { ok: false, status: 404, json: async () => ({}) } : inner(url, init)));
    render(<Diagram />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the diagram");
  });
});
