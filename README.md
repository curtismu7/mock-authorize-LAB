# Mock Authorize LAB

A stand-in for PingOne Authorize that runs on your machine: it answers decision requests in PingOne's shape from rules you can edit, so an app (the P1AZ Inspector in Live mode, a demo, your own code) can run its normal PingOne flow with no tenant.

Tier: Tester
Repo: https://github.com/curtismu7/mock-authorize-LAB
Catalog: G4

**Tier: Tester.** Catalog G4 (Mock Authorize server) is the owner-assigned id this app has always carried; the demo-shelf catalog lists the G4 row as retired, which is an open owner decision (see "Not done"). Standalone: nothing here imports from another repo. The rule knobs and the answer shape follow AI-DEMO2's `demo_authz_server` and PingOne's decision endpoint, and are UNVERIFIED against a real PingOne or PingAuthorize.

## What is simulated

**Mock mode (the only mode, and the default).** Everything runs offline in one process. The engine decides by simple rules you edit. The token endpoint, the decision endpoints and the worker app are all stand-ins: the worker client ID and secret are **mock credentials** for this mock server (shown on the Connect page so they can be pasted into a client, and labelled as mock), and every token it issues is a mock token that is good only here. It is not PingOne, not a policy engine and not a security control. Nothing here reaches a real tenant, and a netguard refuses every outbound socket, DNS lookup, fetch and UDP send or connect (it has a self-test, and a test proves a whole session makes zero attempts).

**Live mode: not available.** This app is itself the mock server, so it has no live backend and never calls PingOne. The header's Mock / Live toggle is on every page; pressing Live is refused with that message and the page stays in mock. `MOCKAZ_LAB_MODE=live` in the settings file is refused at start with the same message. The banner on every page, in presenter mode too, says it is simulated and names the mode.

### What you get

- **Rules** (the page): the deny limit, the step-up limit, the transaction types that always need consent, the MCP tools that are never allowed, and the tools that need a person's approval. Save, and the next decision follows. Saved rules live in `~/.mock-authorize/rules.json`; a value set back to its default is dropped.
- **Try**: send a Transaction, an MCP tool call or custom JSON, and see the verdict, the statements and PingOne's answer.
- **Decisions**: every decision, from the Try page ("Console") and from clients calling the API ("API").
- **Connect**: the base URL, the mock worker client ID and secret, and the endpoints, ready to paste into a client.
- **How it fits**: a ReactFlow diagram (diagram-studio/1 data, loaded by name from `server/diagrams/`) with movable boxes, Simulate, speed and Reset.
- **Presenter mode** (`P`; `Esc` leaves it): a larger page with the talk-track line for the page (`docs/talk-track.md`, generated from `content/stories.json`). The banner stays.

### The PingOne-shaped API

Base `http://127.0.0.1:4850/pingone`. The environment ID in the path is accepted as given.

| | |
|---|---|
| Token | `POST /auth/{env}/as/token` with Basic worker credentials and `grant_type=client_credentials` |
| List | `GET /api/v1/environments/{env}/decisionEndpoints` (Bearer) |
| Decide | `POST /api/v1/environments/{env}/decisionEndpoints/{id}` with `{"parameters": {…}}` (Bearer). Ids: `mock-transaction`, `mock-mcp` |
| Recent | `GET /api/v1/environments/{env}/decisionEndpoints/{id}/recentDecisions?limit=` (Bearer) |

The answer carries `decision`, `statements[{code,name,statement}]`, `correlationId` and `elapsedMicroseconds`. A gate (step-up, consent, human approval) is a PERMIT plus a statement whose code names it (`STEP_UP_MFA`, `HITL_CONSENT`), as the real endpoint signals it (UNVERIFIED). A request with nothing the rules can read is `INDETERMINATE`, PingOne's "could not evaluate", never a quiet permit.

**On-prem PingAuthorize shape (no token).** `POST http://127.0.0.1:4850/governance/pap/alpha/policy/{policyId}/decision` with `{"parameters": {…}}`. This is the call AI-DEMO2's gateway makes to an on-prem PingAuthorize, so this server can stand in for one. It also reads the gateway's `TransactionAmount` field. No token is needed. UNVERIFIED against a real PingAuthorize.

**Use it from the P1AZ Inspector.** On-prem style: in the Inspector's Settings choose "PingAuthorize on-prem (Docker)" and enter `http://127.0.0.1:4850` (from a container: `http://host.docker.internal:4850`). Cloud style: set "PingOne base URL" to `http://127.0.0.1:4850/pingone`, any environment ID, and the worker client ID and secret from the Connect page. Switch to Live P1AZ and press Send. The call shows up here on Decisions as API.

### Safety

Binds `127.0.0.1` only; any other address needs `MOCKAZ_BIND` (the container sets it, and the compose file publishes on `127.0.0.1` only). Every request needs a loopback `Host`, and every console write needs a same-origin `Origin`. The PingOne-shaped API needs a worker token; the token endpoint needs the worker credentials. The worker secret is stored in `~/.mock-authorize/worker.json`, mode 600, and can be rotated. Request bodies are capped at 256 KB and 8 levels of nesting; user text is rendered as text. The browser logs the deliberate 4xx answers (a refused rule, a bad Host) as console messages.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/curtismu7/mock-authorize-LAB.git
cd mock-authorize-LAB
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4850/. `npm run dev` runs the API on 4850 and Vite on 4851.

## Settings file

All standalone apps read one settings file, `~/Development/.env`, which must be mode 600. `STANDALONE_ENV` overrides its path. This app needs none of it. It parses the file (`util.parseEnv`) and takes exactly one optional key; no other key from the file ever enters the server's environment, and there is no per-app `.env`:

- `MOCKAZ_LAB_MODE` (optional): `mock` (the default and the only value). `live` is refused with a message. A bare `MODE` in the shared file is ignored, because it may belong to another app.

The shared file holds no `PORT`: the app keeps its port default in code. Admin or worker credentials for a real tenant never belong in that file, and this app uses none; its own worker credentials are mock and live in `~/.mock-authorize/worker.json`. The doctor never prints a value. Other settings come from the shell: `PORT`, `MOCKAZ_BIND` and `DATA_DIR` (see `.env.example`).

## Ports, and what to do if the port is taken

```
Ports: mock-authorize-LAB listens on 4850 (set with PORT, default 4850).
Port range for this app: 4850-4851.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:4850 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, either stop it or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
   Those are taken by other demos or other tools.
```

Other variables: `VITE_PORT` (Vite dev server, default 4851, `npm run dev`) and `HOST_PORT` (Docker host port, default 4850). The board assigns this app 4850 and the dev UI uses 4851; keep any other choice clear of the forbidden list above.

## Mock and live modes

The header has a **Mock / Live** toggle on every page, with a mode chip, and the banner shows the same mode. Mock is the only mode: pressing Live shows "Live mode is not available: Mock Authorize is itself the mock server. It has no live backend and never calls PingOne. Use mock." and changes nothing. Mock/Live toggles nothing else, because there is nothing live to switch to.

## Health, doctor and reset

```
npm run doctor   # node, bind, mode, state dir, netguard self-test, one real decision through the HTTP layer, free port; PORT=4851 npm run doctor to use a spare port
npm run reset    # POST /api/reset on the running app: rules to defaults, decisions cleared, tokens ended, worker credentials kept
```

`GET /api/health` returns `demo-health/1`. The page's Reset session button does the same and also puts the diagram boxes back. Reset keeps the worker credentials on purpose: rotating them would silently break a client you pasted them into (use Rotate for that). `npm run talk-track` regenerates `docs/talk-track.md` and `npm run content-pack` regenerates `content-pack.json`; both are generated, so do not edit them by hand.

## Docker (optional)

```
HOST_PORT=4850 docker compose up --build -d
```

The container publishes to 127.0.0.1 only (a test pins it), runs as a non-root user with a read-only file system and no capabilities. Use OrbStack, not Docker Desktop. Rules and the mock worker credentials persist in the `mock-authorize-data` volume.

## Tests

```
npm test    # server (node --test), web (vitest), scripts (node --test)
```

The shared checks are run by hand, because the scripts are not shipped into this repo's CI: `bash <AI-DEMO-Standalone>/scripts/check-drift.sh .`, `bash <AI-DEMO-Standalone>/scripts/check-css.sh .` and `node <demo-kit-base>/scripts/conformance.mjs . --new`. Conformance reports two advisory rule 18 warnings on purpose: the deferred SE k8s manifests and the `MODE` switch for that build.

On Node 26: 98 tests pass (46 server, 26 web, 26 scripts).

## Troubleshooting

- **The page is blank or says the server cannot be reached.** The server is not running, or it is on another port. Start it (`npm start`) and check `PORT`.
- **Port is taken.** See "Ports, and what to do if the port is taken" above.
- **`npm start` refuses to start.** Run `npm run doctor`; the first failing line says why (Node older than 26, a state directory that is not mode 700, `MOCKAZ_LAB_MODE=live`).
- **A client gets 401 from the decision endpoint.** It needs a worker token first, and Reset ends every issued token. Get a new one from the token endpoint with the mock worker credentials on the Connect page.
- **The browser console shows red 4xx lines.** Some are deliberate: a refused rule edit, or a call with no token. They are answers, not crashes.

## Ownership

- Owner: the Ping demo family owner (Tester tier).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

## Not done

No SE k8s build (deferred by the owner, 2026-10-31); the earlier hosted build and its per-visitor workspaces were removed in this move. There is no live mode. Every product claim stays UNVERIFIED until it is measured on a tenant. The catalog id G4 is the id the app has always carried; the demo-shelf catalog marks that row retired, so confirm it or assign a new one.
