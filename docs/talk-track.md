# Mock Authorize LAB: talk track

Generated from `content/stories.json` by `npm run talk-track`. Do not edit by hand: edit the stories, then regenerate.

Say first: this is a simulation. Mock Authorize answers from rules on this machine. It is not PingOne, and its answer shapes are UNVERIFIED against PingOne. The banner on every page says so, in presenter mode too.

## S01 Set the rules

Open Rules. Lower the deny limit, add a tool that is never allowed, and save. The next decision follows the change; no restart, no tenant.

## S02 Try a request

On Try, send a transaction or an MCP tool call and read the verdict, the statements and PingOne's answer. A gate such as step-up is a permit plus a statement that names it.

## S03 Point a client at it

Connect shows the base URL and the mock worker credentials. A client gets a token, calls the decision endpoint and its call appears on Decisions marked API next to your own.

## S04 Start over

Reset session restores the default rules, clears the decision log and ends issued tokens. The worker credentials stay, so a client that has the secret still works.
