# Changelog

## 0.1.0 (unreleased)
- Fix pass: re-ported the loopback-bind, decision-log byte-budget and worker-secret-not-echoed tests (they went with the hosted tests), added tests for the deny limit boundary and the recentDecisions limit clamp, the startup log now names the real bound address, and the first diagram group is "Caller" so it no longer repeats the node title.
- Moved to the -LAB standard (`mock-authorize-LAB`): Node 26, shared stylesheet and tokens-only app CSS, Mock | Live toggle in the header on every page (Live is refused: this app is the mock), banner naming the mode, presenter mode (P / Esc), talk track generated from `content/stories.json` with a drift test, the diagram served as diagram-studio/1 data by name, one shared settings file (`MOCKAZ_LAB_MODE` only), `dgram` connect guard in the netguard, hosted GitHub CI.
- Removed the SE hosted build: `k8s/`, `MODE` / `MOCKAZ_HOSTED`, per-visitor workspaces, cookies, `MOCKAZ_ALLOWED_HOSTS`, the path-prefix build and its tests.
- First cut: editable rules, Try, Decisions, Connect and a "How it fits" diagram, with a PingOne-shaped token, decisionEndpoints, decision and recentDecisions API.
- Gates are PERMIT plus a statement code (the real endpoint's way); unreadable requests are INDETERMINATE.
- Rule knobs and answer shape follow AI-DEMO2 `demo_authz_server` and the P1AZ Inspector's Mock engine; code written fresh, shell copied from p1az-inspector.
- Also answers the on-prem PingAuthorize shape: `POST /governance/pap/alpha/policy/{id}/decision`, no token; reads the gateway's `TransactionAmount`.
