// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { returnLinkFor } from "../return-link/returnTargets.js";
import App from "../App.jsx";

const RULES = { denyAmountUsd: 2000, stepUpAmountUsd: 500, consentTypes: ["transfer"], denyTools: [], hitlTools: [] };
const NOTE = { name: "Opened from Customer Agent LAB" };
beforeEach(() => {
  window.location.hash = "";
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: RULES, defaults: RULES, edited: [], decisions: [] }) }));
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: banner first, strip right below, header Back in the tools", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC6&vertical=banking");
    render(<App />);
    const note = await screen.findByRole("note", NOTE);
    expect(note.textContent).toContain("UC6");
    expect(document.querySelector("p.banner").nextElementSibling).toBe(note);
    expect(document.querySelector(".top__tools > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC6", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC6&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByRole("heading", { name: "Rules" });
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/mock-authorize/?from=customer-agent&uc=UC6");
    expect(returnLinkFor("mock-authorize").href).toBe("/customer-agent/?returned=mock-authorize&uc=UC6");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC6");
    expect(returnLinkFor("mock-authorize").href).toBe("http://127.0.0.1:5603/?returned=mock-authorize&uc=UC6");
  });
});
