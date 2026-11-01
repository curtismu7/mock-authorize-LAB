// Rule 3: the talk track is generated from data (content/stories.json), and the page's presenter mode reads the same data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readStories, renderTalkTrack, TALK_TRACK_PATH } from './build-talk-track.mjs';

const app = fs.readFileSync(fileURLToPath(new URL('../web/src/App.jsx', import.meta.url)), 'utf8');

test('docs/talk-track.md is exactly what the generator writes from content/stories.json (drift test)', () => {
  assert.equal(fs.readFileSync(TALK_TRACK_PATH, 'utf8'), renderTalkTrack(readStories()));
});

test('every story appears in the talk track with its title and its say line', () => {
  const doc = fs.readFileSync(TALK_TRACK_PATH, 'utf8');
  const stories = readStories();
  assert.ok(stories.length >= 4);
  for (const s of stories) {
    assert.ok(doc.includes(`## ${s.id} ${s.title}`), s.id);
    assert.ok(doc.includes(s.say), s.id);
  }
});

test('the talk track says it is a simulation and that the answer shapes are UNVERIFIED', () => {
  const doc = fs.readFileSync(TALK_TRACK_PATH, 'utf8');
  assert.match(doc, /simulation/);
  assert.match(doc, /UNVERIFIED/);
});

test('the page maps each of its pages to a story that exists, and imports the same stories file', () => {
  const ids = new Set(readStories().map((s) => s.id));
  const map = /const PRESENTER_STORY = \{([^}]*)\}/.exec(app)?.[1] || '';
  const used = [...map.matchAll(/"(S\d\d)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 5, 'every page has a talk-track line');
  for (const id of used) assert.ok(ids.has(id), `${id} is a story`);
  assert.match(app, /from "\.\.\/\.\.\/content\/stories\.json"/);
});

test('the generator is deterministic', () => {
  assert.equal(renderTalkTrack(readStories()), renderTalkTrack(readStories()));
});
