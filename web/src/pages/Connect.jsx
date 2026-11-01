import React, { useEffect, useState } from "react";
import { get, post } from "../lib/api.js";

// How a client (the P1AZ Inspector's Live mode, or your own code) talks to this server as if it were PingOne.
// The worker credential is a MOCK credential for this MOCK server, shown so it can be pasted into the client.
export default function Connect() {
  const [worker, setWorker] = useState(null);
  const [config, setConfig] = useState(null);
  useEffect(() => { get("/api/worker").then((r) => r.ok && setWorker(r.data)); get("/api/config").then((r) => r.ok && setConfig(r.data)); }, []);
  const origin = window.location.origin;
  const base = `${origin}${config?.pingonePath || "/pingone"}`;
  const row = (label, value) => <tr><th scope="row">{label}</th><td><code>{value}</code></td></tr>;

  return (
    <>
      <h2>Connect a client</h2>
      <p className="lede">This server answers like PingOne Authorize: a worker token, a list of decision endpoints, decisions, and recent decisions. Point a client at it and run its normal flow with no tenant.</p>
      <div className="card">
        <h3>In the P1AZ Inspector (Settings page)</h3>
        <table className="kv"><tbody>
          {row("PingOne base URL", base)}
          {row("Environment ID", "any UUID, for example 00000000-0000-4000-8000-000000000000")}
          {row("Worker client ID", worker?.clientId || "…")}
          {row("Worker client secret", worker?.clientSecret || "…")}
          {row("Decision endpoint", config?.endpoints.map((e) => e.id).join(" or ") || "…")}
        </tbody></table>
        <p className="muted small">Then switch the Inspector to Live P1AZ and press Send. The decision shows up on the Decisions page here, as API.</p>
        <button type="button" onClick={async () => { const r = await post("/api/worker/rotate"); if (r.ok) setWorker(r.data); }}>Rotate the worker secret</button>
      </div>
      <div className="card">
        <h3>As an on-prem PingAuthorize (no token)</h3>
        <p className="muted small">UNVERIFIED: this path follows the AI-DEMO2 gateway call and has been checked only against this stand-in, not a real PingAuthorize.</p>
        <table className="kv"><tbody>
          {row("PingAuthorize URL", origin)}
          {row("Decide", `POST ${origin}/governance/pap/alpha/policy/{policyId}/decision   body {"parameters": {…}}`)}
        </tbody></table>
        <p className="muted small">In the P1AZ Inspector's Settings choose "PingAuthorize on-prem (Docker)" and enter the URL. From a container use host.docker.internal instead of 127.0.0.1.</p>
      </div>
      <div className="card">
        <h3>The PingOne cloud endpoints</h3>
        <table className="kv"><tbody>
          {row("Token", `POST ${base}/auth/{env}/as/token`)}
          {row("List", `GET ${base}/api/v1/environments/{env}/decisionEndpoints`)}
          {row("Decide", `POST ${base}/api/v1/environments/{env}/decisionEndpoints/{id}   body {"parameters": {…}}`)}
          {row("Recent", `GET ${base}/api/v1/environments/{env}/decisionEndpoints/{id}/recentDecisions`)}
        </tbody></table>
      </div>
    </>
  );
}
