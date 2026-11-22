#!/usr/bin/env node
// Mock Authorize LAB companion MCP server (stdio).
//
// Exposes the lab's HTTP routes as MCP tools so an MCP client can drive the
// same surface the Postman collection covers. The lab stays the single source
// of state (workspaces, rules, tokens); this server is a thin proxy.
//
// Configuration:
//   MOCKAZ_LAB_BASE  base URL of a running Mock Authorize LAB (default http://localhost:4850)
//
// Run: node mcp/server.mjs

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.MOCKAZ_LAB_BASE || 'http://localhost:4850').replace(/\/+$/, '');
const ORIGIN = process.env.MOCKAZ_LAB_ORIGIN || 'http://localhost:4850';

async function call(path, { method = 'GET', body, form, headers: extraHeaders = {} } = {}) {
  const headers = { origin: ORIGIN, ...extraHeaders };
  let payload;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const text = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });

const server = new McpServer({
  name: 'mock-authorize-lab',
  version: '0.1.0',
  title: 'Mock Authorize LAB tools',
  description: 'Drive Mock Authorize LAB: the mock worker token, the PingFederate-shaped token endpoint, the PingOne-shaped decision endpoints (permit/deny/indeterminate through the rules), the tokenless PAP decision route, and the rules/decision log. Everything is a labelled mock; the lab has no live mode.',
});

server.registerTool('mockaz_health', {
  title: 'Lab health',
  description: 'Check the lab is running and report its runtime state.',
  inputSchema: {},
}, async () => text(await call('/api/health')));

server.registerTool('mockaz_info', {
  title: 'Mode info',
  description: 'Mode (always mock: the lab is itself the mock server), simulated flag, live refusal message.',
  inputSchema: {},
}, async () => text(await call('/api/info')));

server.registerTool('mockaz_worker_credentials', {
  title: 'Mock worker credentials',
  description: 'The mock worker client id and secret for this workspace. Feed them to mockaz_token.',
  inputSchema: {},
}, async () => text(await call('/api/worker')));

server.registerTool('mockaz_token', {
  title: 'Token (client_credentials)',
  description: 'Call the PingFederate-shaped token endpoint with the worker credentials (HTTP Basic). Only client_credentials is supported; wrong credentials answer 401 invalid_client.',
  inputSchema: {
    clientId: z.string().describe('Worker client id from mockaz_worker_credentials'),
    clientSecret: z.string().describe('Worker client secret'),
    envId: z.string().default('db67be8c').describe('Environment id in the token path'),
  },
}, async ({ clientId, clientSecret, envId }) => {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await call(`/pingone/auth/${encodeURIComponent(envId)}/as/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}` },
    form: { grant_type: 'client_credentials' },
  });
  return text(r);
});

server.registerTool('mockaz_decision_endpoints', {
  title: 'List decision endpoints',
  description: 'The decision endpoints for the environment (mock-transaction, mock-mcp), via the PingOne-shaped surface with the worker token.',
  inputSchema: {
    token: z.string().describe('Access token from mockaz_token'),
    envId: z.string().default('db67be8c'),
  },
}, async ({ token, envId }) => text(await call(`/pingone/api/v1/environments/${encodeURIComponent(envId)}/decisionEndpoints`, {
  headers: { authorization: `Bearer ${token}` },
})));

server.registerTool('mockaz_decide', {
  title: 'Evaluate a decision',
  description: 'One decision through the PingOne-shaped endpoint with the worker token. Parameters: Amount (number), TransactionType (e.g. purchase/withdrawal), ToolName for the MCP endpoint. Over the deny limit → DENY; missing attributes → INDETERMINATE.',
  inputSchema: {
    token: z.string().describe('Access token from mockaz_token'),
    parameters: z.record(z.string(), z.unknown()).describe('e.g. {"Amount":150,"TransactionType":"purchase"}'),
    endpoint: z.string().default('mock-transaction'),
    envId: z.string().default('db67be8c'),
  },
}, async ({ token, parameters, endpoint, envId }) => text(await call(`/pingone/api/v1/environments/${encodeURIComponent(envId)}/decisionEndpoints/${encodeURIComponent(endpoint)}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: { parameters },
})));

server.registerTool('mockaz_pap_decision', {
  title: 'Direct PAP decision (no token)',
  description: 'The /governance/pap/alpha/policy/:policyId/decision route: no token needed, recorded like any other.',
  inputSchema: {
    parameters: z.record(z.string(), z.unknown()),
    policyId: z.string().default('mock-policy'),
  },
}, async ({ parameters, policyId }) => text(await call(`/governance/pap/alpha/policy/${encodeURIComponent(policyId)}/decision`, {
  method: 'POST',
  body: { parameters },
})));

server.registerTool('mockaz_rules', {
  title: 'Current rules',
  description: 'The active rule set for this workspace, with the defaults.',
  inputSchema: {},
}, async () => text(await call('/api/rules')));

server.registerTool('mockaz_decisions_log', {
  title: 'Decision log',
  description: 'This workspace\'s decision log (every source: token-gated, PAP, console).',
  inputSchema: {},
}, async () => text(await call('/api/decisions')));

const transport = new StdioServerTransport();
await server.connect(transport);
