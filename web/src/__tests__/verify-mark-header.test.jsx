import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import App from "../App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const RULES = { denyAmountUsd: 2000, stepUpAmountUsd: 500, consentTypes: ["transfer"], denyTools: [], hitlTools: [] };
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const json = (data) => ({ ok: true, status: 200, json: async () => data });

function withShelf(payload) {
  globalThis.fetch = vi.fn(async (url) => (url === "/api/shelf" ? json(payload) : json({ rules: RULES, defaults: RULES, edited: [], decisions: [] })));
}

beforeEach(() => { window.location.hash = ""; });
afterEach(() => { vi.restoreAllMocks(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "mock-authorize", verification: mark("verified", "Verified", { note: "Every rule and the decision API checked" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every rule and the decision API checked"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the mark is none", async () => {
    for (const payload of [
      { shelfUrl: "http://shelf.example" },
      { shelfUrl: "http://shelf.example", demos: [{ id: "mock-authorize", verification: null }] },
      { shelfUrl: "http://shelf.example", demos: [{ id: "mock-authorize", verification: mark("none", "") }] },
    ]) {
      withShelf(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });

  it("is rendered by App.jsx with this lab's shelf id (removing the line fails this test)", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src", "App.jsx"), "utf8");
    expect(app).toMatch(/<VerifyMark id="mock-authorize" \/>/);
    const shelf = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "docs", "shelf-entry.json"), "utf8"));
    expect(shelf.demos[0].id).toBe("mock-authorize");
  });
});
