#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root). Format: docs/content-pack.schema.json (a copy of the Learning Hub schema).
 * Glossary from content/terms.json, stories from content/stories.json, cards for the three pages. Deterministic: lists sorted by
 * id, 2-space JSON, no timestamps. The git commit is recorded only when passed (--commit=<sha>), so a plain run is reproducible.
 *
 * Sources: none. No public documentation URL is cited in this repo that was verified, so the pack lists none, and product claims
 * are labelled UNVERIFIED in the glossary.
 *
 * CATALOG is the family-plan catalog id the hub requires: G4 (Mock Authorize server; owner-assigned, a real row, not a placeholder).
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
export const CATALOG = 'G4';
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The UI is one page per view with a hash route.
const CARDS = [
  { id: 'rules', label: 'Edit the rules', description: 'Change the deny limit, the step-up limit and the tool lists. The next decision follows.', group: 'setup', href: '/#rules', terms: ['rules', 'mock-authorize'], story: 'S01' },
  { id: 'try', label: 'Send a request and read the verdict', description: 'Send a transaction or an MCP tool call and see the verdict, the statements and the exact answer.', group: 'try-it', href: '/#try', terms: ['decision', 'statements'], story: 'S02' },
  { id: 'connect', label: 'Point a client at the mock', description: 'The base URL and the mock worker credentials, ready to paste into a PingOne-shaped client.', group: 'setup', href: '/#connect', terms: ['worker-token', 'pingone-shaped-api', 'reset', 'netguard'], story: 'S03' },
  { id: 'flow', label: 'How a decision travels', description: 'Client, token, decision endpoint, rules and verdict as a movable diagram with Simulate.', group: 'concept', href: '/#diagram', terms: ['pingone-shaped-api'], story: 'S04' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = readJson('content/stories.json').sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'mock-authorize',
    title: 'Mock Authorize LAB',
    version: pkg.version,
    ...(commit ? { source: { repo: 'mock-authorize-LAB', commit } } : {}),
    demo: { id: 'mock-authorize', name: 'Mock Authorize LAB', catalog: CATALOG, baseUrl: 'http://localhost:4850', doctor: '/api/health', tags: ['pingone-authorize', 'decision', 'mock', 'tester'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'flow', label: 'How a decision travels', href: '/#diagram' }],
    stories,
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}
