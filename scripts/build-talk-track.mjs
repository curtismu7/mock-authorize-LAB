#!/usr/bin/env node
// Writes docs/talk-track.md from content/stories.json, the same data the page's presenter mode reads, so the doc and the page cannot
// drift (scripts/talk-track.test.mjs fails if docs/talk-track.md is not exactly what this generates).
//   node scripts/build-talk-track.mjs        (npm run talk-track)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TALK_TRACK_PATH = path.join(ROOT, 'docs', 'talk-track.md');
export const readStories = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'stories.json'), 'utf8'));

export function renderTalkTrack(stories) {
  const lines = [
    '# Mock Authorize LAB: talk track',
    '',
    'Generated from `content/stories.json` by `npm run talk-track`. Do not edit by hand: edit the stories, then regenerate.',
    '',
    'Say first: this is a simulation. Mock Authorize answers from rules on this machine. It is not PingOne, and its answer shapes are UNVERIFIED against PingOne. The banner on every page says so, in presenter mode too.',
    '',
  ];
  for (const s of stories) lines.push(`## ${s.id} ${s.title}`, '', s.say, '');
  return `${lines.join('\n')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(TALK_TRACK_PATH, renderTalkTrack(readStories()));
  console.log('wrote docs/talk-track.md');
}
