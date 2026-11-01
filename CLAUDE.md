# CLAUDE.md

Mock Authorize LAB (tier Tester, catalog G4, port 4850). A local stand-in for PingOne Authorize: editable rules, Try, a Decisions log, a Connect page, a PingOne-shaped token / decisionEndpoints / decision / recentDecisions API and the on-prem PingAuthorize decision path. It only ever answers; it never calls out. Simulated, and mock is the only mode (Live is refused with a message).

## Commands (from package.json)

```bash
npm ci
npm test             # server (node:test) + web (vitest) + scripts/*.test.mjs
npm run build        # builds web/dist, served by the server itself
npm run doctor       # node, bind, mode, state dir, netguard self-test, one real decision, free port
npm run reset        # POST /api/reset on the running app (rules to defaults, decisions cleared, tokens ended; worker credentials kept)
npm run e2e          # real browser, loopback only; build first
npm run talk-track   # regenerates docs/talk-track.md from content/stories.json (do not hand-edit it)
npm run content-pack # regenerates and validates content-pack.json (do not hand-edit it)
npm start            # http://127.0.0.1:4850/  (PORT to change)
```

Docker (OrbStack, never Docker Desktop): `HOST_PORT=4850 docker compose up --build -d` (publishes `127.0.0.1:` only). Node 26 only.

## Rules that bite here

- **Zero outbound, no exceptions (netguard).** `server/src/netguard.js` refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect. This app has no reason to leave the machine, so there is no permit mechanism. Never add an outbound call.
- **Mock is the only mode.** The header toggle is on every page; Live is refused with `LIVE_REFUSAL` (`server/src/config.js`). The one setting this app reads from the shared `~/Development/.env` is `MOCKAZ_LAB_MODE` (`server/src/settings.js`, `util.parseEnv`, only that key). Never a bare `MODE`, never a per-app `.env` loader, never `process.env.MODE`.
- **Mock-issued tokens are labelled and only good here.** The worker client secret is shown on Connect (it is a mock credential, for education) but never appears in logs. Reset ends every issued token and keeps the worker credentials.
- **Loopback only.** Bind `127.0.0.1`; keep the Host check and the same-origin write check (`security.js`) in front of every route. Docker publishes `127.0.0.1:` only (`scripts/compose.test.mjs` pins it).
- **Diagrams are data.** `server/diagrams/*.json` (diagram-studio/1), loaded by name through `server/src/diagramData.js` and checked with the studio's validator copy. The page draws what `GET /api/diagram?name=` returns; no hand-built nodes or edges. Reset restores box positions.
- **UI.** `web/src/styles/standalone-ui.css` is vendored byte-for-byte from `AI-DEMO-Standalone/shared/`; app CSS uses tokens only (no colour literals, no `prefers-color-scheme`, no `!important`, breakpoints 600px and 900px). Check with `bash ~/Development/AI-DEMO-Standalone/scripts/check-css.sh .`. Run buttons use `aria-disabled`, not `disabled`. Keep the `main` landmark.
- **No identifiers from other projects.** Fixtures use `00000000-0000-4000-8000-000000000000`. The forbidden-strings scan must print 0: `git log -p --all | grep -cF -f ~/.config/demo-kit/forbidden-strings.txt`. Never print or copy that file. gitleaks runs in `.githooks/pre-commit`; do not bypass it.
- **Test scripts use globs, never directories** (`node --test test/*.test.js`). Never parse `node:test` stdout: use the exit code or `--test-reporter=spec`.
- **Never use `crypto.generateKeyPairSync('ec')` or async `generateKeyPair`** (SIGABRT on Node 20 in CI).
- **Product claims are UNVERIFIED unless sourced.** The answer shapes follow AI-DEMO2's integration; neither a real PingOne tenant nor a real PingAuthorize has been checked. Say so in docs and UI.
- **No SE k8s build** (deferred by the owner, 2026-10-31): no manifests, no hosted mode, no `MODE` switch, no per-visitor workspaces. There is one workspace, "default".
- Never edit the shared `~/Development/AI-DEMO2` checkout; it is a read-only source. Never import across repos.

## Where the safety claims are pinned

- `server/test/netguard.test.js`: the guard's self-test (7 routes out, including UDP connect), and ZERO attempts across a whole session (PingOne-shaped API, on-prem path, Try, Reset).
- `server/test/reset.test.js` and `scripts/reset.test.mjs`: Reset restores rules, clears the log, ends tokens, keeps worker credentials, refuses cross-origin; the script is loopback only.
- `server/test/lab.test.js`: mode (live refused), the settings reader (only its own key), the diagram as data, health `demo-health/1`, doctor.
- `server/test/api.test.js`, `server/test/guards.test.js`: Host/Origin guards, limits, and the PingOne-shaped answers.
- `web/src/pages/__tests__/`: pages, the header toggle on every page, presenter keys, Reset session.
- `scripts/talk-track.test.mjs`: `docs/talk-track.md` is exactly what the generator writes from the stories.
- `scripts/content-pack.test.mjs`: the hub pack validates and is exactly what the build script generates.
- `scripts/repo.test.mjs`, `scripts/compose.test.mjs`: required files, README standard, CSS standard, CI, Node 26, no k8s, Docker lock-down.

## Content

Edit `content/terms.json` and `content/stories.json`, then `npm run talk-track` and `npm run content-pack`.
