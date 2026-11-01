import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";

const RULES = { denyAmountUsd: 2000, stepUpAmountUsd: 500, consentTypes: ["transfer"], denyTools: [], hitlTools: [] };

beforeEach(() => {
  window.location.hash = "";
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: RULES, defaults: RULES, edited: [], decisions: [] }) }));
});

describe("App navigation", () => {
  it("opens on Rules, not on a page that does not exist", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Rules" })).toBeInTheDocument();
  });

  it("switches page when the hash changes in place (Back, Forward or a typed fragment)", async () => {
    render(<App />);
    await act(async () => {
      window.location.hash = "decisions";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { name: "Decisions" })).toBeInTheDocument();
  });
});
