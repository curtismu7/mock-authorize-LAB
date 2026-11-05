import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.data', 'package-lock.json'].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', '.nvmrc', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/shelf-entry.json', 'docs/content-pack.schema.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/build-talk-track.mjs', 'web/src/styles/standalone-ui.css', 'server/diagrams/mock-authorize-flow.json', '.gitignore']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the shelf entry is valid and portable, and carries the same catalog id as the content pack', () => {
  const e = json('docs/shelf-entry.json').demos[0];
  assert.equal(e.id, 'mock-authorize');
  assert.equal(e.kind, 'Tester');
  assert.equal(e.catalogId, 'G4');
  assert.equal(json('content-pack.json').demo.catalog, 'G4');
  assert.equal(e.healthPath, '/api/health');
  assert.equal(e.url, 'http://localhost:4850');
  assert.equal(e.composeFile, 'mock-authorize-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(e.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(e)), 'no absolute home path');
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted|RUNS_ON|k8s/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /forbidden-strings:/);
  assert.match(ci, /gitleaks/);
  assert.match(ci, /PORT=4851 npm run doctor/);
});

test('Node 26 everywhere: engines, .nvmrc, both Dockerfile stages, and a doctor check', () => {
  assert.equal(json('package.json').engines.node, '>=26');
  assert.equal(read('.nvmrc').trim(), '26');
  assert.ok((read('Dockerfile').match(/^FROM node:26-alpine/gm) || []).length === 2);
  assert.match(read('server/src/doctor.js'), /major >= 26/);
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the port text, the 12 sections in order', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/);
  assert.match(r, /^Tier: Tester$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/mock-authorize-LAB$/m);
  assert.match(r, /^Catalog: G4$/m);
  assert.match(r, /lsof -iTCP:4850 -sTCP:LISTEN -n -P/);
  assert.match(r, /PORT=<other port> npm start/);
  const at = (h) => r.indexOf(`\n## ${h}`);
  const order = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do', 'Mock and live modes', 'Health, doctor and reset', 'Docker', 'Tests', 'Troubleshooting', 'Ownership'].map(at);
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order');
  assert.match(r, /util\.parseEnv/);
  assert.match(r, /UNVERIFIED/);
  assert.ok(!/ping-devops|cmuir/i.test(r));
  assert.ok(!/\bdoor\b/i.test(r + read('CLAUDE.md')));
});

test('app CSS follows the CSS standard: tokens only, no dark-mode media query, no forced priority, no italics, breakpoints 600 and 900 only, no purple', () => {
  const css = read('web/src/app.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(css), 'no colour literal');
  assert.ok(!/prefers-color-scheme/.test(css)); assert.ok(!/!important/.test(css)); assert.ok(!/font-style:\s*italic/.test(css));
  const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
  assert.ok(widths.length > 0 && widths.every((w) => w === '600' || w === '900'), widths.join());
  assert.ok(!/purple|violet|magenta|indigo/i.test(css + read('web/src/styles/standalone-ui.css').replace(/--[a-z-]+:[^;]*;/g, '')));
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('standalone-ui.css') < main.indexOf('app.css'), 'the shared stylesheet loads before the app stylesheet');
  const pages = ['App.jsx', ...fs.readdirSync(path.join(root, 'web/src/pages')).filter((f) => f.endsWith('.jsx')).map((f) => `pages/${f}`)];
  assert.ok(!/style=\{\{/.test(pages.map((f) => read(`web/src/${f}`)).join('\n')), 'no style attributes');
  assert.ok(!/(?<!aria-)disabled=\{/.test(pages.map((f) => read(`web/src/${f}`)).join('\n')), 'buttons use aria-disabled, not disabled');
});

test('no k8s, no SE or hosted code, no bare MODE, no per-app .env loader, no EC generateKeyPair', () => {
  assert.ok(!fs.existsSync(path.join(root, 'k8s')));
  const code = walk(root).filter((p) => /\.(m?js|jsx)$/.test(p) && !/\.test\.|__tests__|repo\.test/.test(p));
  const hits = [];
  for (const p of code) {
    const t = fs.readFileSync(p, 'utf8');
    for (const [name, re] of [['process.env.MODE', /process\.env\.MODE\b/], ['env.MODE', /\benv\.MODE\b/], ['MOCKAZ_HOSTED', /MOCKAZ_HOSTED/], ['MOCKAZ_ALLOWED_HOSTS', /MOCKAZ_ALLOWED_HOSTS/], ['loadEnvFile', /loadEnvFile/], ['EC keygen', /generateKeyPair(Sync)?\(\s*['"]ec['"]/], ['__SE_HOST__', /__SE_HOST__|__IMAGE__/]]) {
      if (re.test(t)) hits.push(`${path.relative(root, p)}: ${name}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('the shared settings file is the only settings file: no per-app .env is read', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.match(read('server/src/index.js'), /applySharedSettings\(\)/);
  assert.match(read('scripts/doctor.mjs'), /applySharedSettings\(\)/);
});

test('only .example and .invalid hosts and the fixture environment id appear in shipped text', () => {
  const hits = [];
  for (const p of walk(root)) {
    if (!/\.(md|json|m?js|jsx|css|yml|html)$/.test(p) || /\.test\.|__tests__|node_modules/.test(p) || p.endsWith('standalone-ui.css')) continue;
    const t = read(path.relative(root, p));
    for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const h = m[1].toLowerCase();
      if (!(/\.(example|invalid)$/.test(h) || ['127.0.0.1', 'localhost', 'github.com', 'json-schema.org', 'www.w3.org', 'registry.npmjs.org', 'host.docker.internal'].includes(h))) hits.push(`${path.relative(root, p)}: ${h}`);
    }
    for (const m of t.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) {
      if (m[0] !== '00000000-0000-4000-8000-000000000000') hits.push(`${path.relative(root, p)}: uuid ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('the Docker image copies the diagram data and the stories the page imports', () => {
  const d = read('Dockerfile');
  assert.match(d, /COPY server\/diagrams server\/diagrams/);
  assert.match(d, /COPY content content/);
});
