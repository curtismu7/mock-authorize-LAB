// The diagrams are diagram-studio/1 DATA (server/diagrams/*.json), loaded by name and checked with the studio's own validator
// copy. Nothing here builds nodes or edges by hand. Each step names the edges it lights, walked in order by Simulate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDiagram } from './diagramStudioValidate.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../diagrams');
export const DIAGRAM_NAMES = ['mock-authorize-flow'];

function readDiagram(name) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  const problems = validateDiagram(doc);
  if (problems.length) throw new Error(`diagram ${name} is not valid diagram-studio/1: ${problems.join('; ')}`);
  return doc;
}
const DOCS = Object.fromEntries(DIAGRAM_NAMES.map((n) => [n, readDiagram(n)]));

// By name only: a name that is not in the list is an error, so a request can never choose a file path.
export function loadDiagram(name) {
  if (!DIAGRAM_NAMES.includes(name)) throw new Error('no such diagram');
  return DOCS[name];
}
