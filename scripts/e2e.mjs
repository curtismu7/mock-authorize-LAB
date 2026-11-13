#!/usr/bin/env node
// Real-browser run of the host-run app with a temp DATA_DIR. Drives: the header (Mock | Live, presenter), edit a rule, Try shows
// the change, a real API client (worker token, then decision) lands on the Decisions page as API, Connect shows the worker
// credentials, the diagram.
// No network beyond loopback. Screenshots go to .data/e2e-screenshots (git-ignored). Not run by CI.
//   npm run build   (once; the server serves web/dist)      npm run e2e
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function waitFor(url, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    if (Date.now() > end) throw new Error(`${url} did not come up`);
    await sleep(150);
  }
}
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mockaz-e2e-'));
fs.mkdirSync(shots, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(work, 'data') }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const ENV = '00000000-0000-4000-8000-000000000000';
let browser;
try {
  await waitFor(`${base}/api/health`);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/`);
  // The default page must render something: a blank main area was shipped once (the default was a page that did not exist).
  await page.getByLabel(/Deny above/).waitFor({ timeout: 10000 }).catch(() => {});
  check(await page.getByLabel(/Deny above/).count() === 1, 'Default page: opens on Rules, not blank');
  check((await page.getByRole('note').innerText()).startsWith('Simulated, mock mode.'), 'Banner: says simulated and names the mode');
  // The shared TopMenu: the mode is a select; Real is a disabled option whose title says why.
  const real = page.getByTestId('mode-real');
  await page.waitForFunction(() => document.querySelector('[data-testid="mode-real"]')?.disabled === true);
  const realTitle = (await real.getAttribute('title')) || '';
  check((await real.evaluate((o) => o.disabled)) === true && /not available/i.test(realTitle), `Header toggle: Real is disabled and says why ("${realTitle.slice(0, 70)}")`);
  check((await page.getByTestId('mode').innerText()) === 'Mode: mock', 'Header toggle: the mode stays mock');
  await page.keyboard.press('p');
  await page.getByRole('complementary', { name: 'Talk track' }).waitFor();
  check((await page.getByRole('note').count()) === 1, 'Presenter (P): shows the talk-track line and keeps the banner');
  await page.keyboard.press('Escape');
  check((await page.getByRole('complementary', { name: 'Talk track' }).count()) === 0, 'Presenter (Esc): leaves presenter mode');

  // Rules: lower the deny limit, then Try a 500 deposit (allowed by default).
  await page.getByRole('link', { name: 'Try' }).click();
  await page.getByRole('combobox', { name: 'Type' }).selectOption('deposit');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByTestId('result').getByText('Permit').first().waitFor();
  check(true, 'Try: a 500 deposit is permitted by the default rules');
  await page.getByRole('link', { name: 'Rules' }).click();
  await page.getByLabel(/Deny above/).fill('100');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText(/Saved\./).waitFor();
  await page.screenshot({ path: path.join(shots, 'rules.png') });
  await page.getByRole('link', { name: 'Try' }).click();
  await page.getByRole('combobox', { name: 'Type' }).selectOption('deposit');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByTestId('result').getByText('Deny').first().waitFor();
  check(true, 'Try: after lowering the limit to 100 the same deposit is denied');
  await page.screenshot({ path: path.join(shots, 'try.png') });

  // A real client: worker credentials from Connect, token, decision, then it shows up as API.
  await page.getByRole('link', { name: 'Connect' }).click();
  await page.getByText(/mock-worker/).waitFor();
  const w = await (await fetch(`${base}/api/worker`)).json();
  check(await page.getByText(w.clientSecret).count() > 0, 'Connect: shows the mock worker credentials to paste into a client');
  const basic = Buffer.from(`${w.clientId}:${w.clientSecret}`).toString('base64');
  const tok = await (await fetch(`${base}/pingone/auth/${ENV}/as/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })).json();
  const dec = await (await fetch(`${base}/pingone/api/v1/environments/${ENV}/decisionEndpoints/mock-transaction`, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ parameters: { Amount: 500, TransactionType: 'deposit' } }) })).json();
  check(dec.decision === 'DENY' && !!dec.correlationId, 'API: a client with a worker token gets the edited rule (DENY) in PingOne shape');
  await page.getByRole('link', { name: 'Decisions' }).click();
  await page.locator('.calls .engine', { hasText: 'API' }).first().waitFor({ timeout: 10000 });
  check((await page.locator('.calls .engine', { hasText: 'Console' }).count()) > 0, 'Decisions: shows both the API call and the console call');
  await page.screenshot({ path: path.join(shots, 'decisions.png') });

  await page.getByRole('link', { name: 'How it fits' }).click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.getByTestId('caption').getByText(/Step 1/).waitFor();
  check(true, 'Diagram: Simulate shows a captioned step');
  // Rule 3: Reset session in a real browser restores the rules, clears the log and ends the old token, and says so.
  const stale = tok.access_token;
  await page.getByTestId('reset').click();
  await page.getByText(/Worker credentials kept/).waitFor();
  check((await (await fetch(`${base}/api/decisions`)).json()).decisions.length === 0, 'Reset session: the decision log is empty');
  check((await (await fetch(`${base}/api/rules`)).json()).edited.length === 0, 'Reset session: rules are back to defaults');
  check((await fetch(`${base}/pingone/api/v1/environments/${ENV}/decisionEndpoints`, { headers: { Authorization: `Bearer ${stale}` } })).status === 401, 'Reset session: the old token no longer works');
} catch (err) {
  console.error(err.message); failures++;
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
