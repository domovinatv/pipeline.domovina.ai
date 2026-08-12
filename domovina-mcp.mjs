#!/usr/bin/env node
// domovina-mcp.mjs — Stdio ↔ Streamable HTTP proxy za Domovina MCP.
//
// Radi puni OAuth 2.1 + DCR + PKCE flow automatski (no browser needed):
//   1. Register client (DCR) na /register
//   2. PKCE authorize → server auto-redirects → parse code from Location header
//   3. Exchange code for access_token via /token
//   4. Forward MCP messages over StreamableHTTP s Bearer tokenom
//
// Antigravity CLI pokreće ovo kao stdio subprocess.

import { randomBytes, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const MCP_URL = process.env.DOMOVINA_MCP_URL || "https://mcp.domovina.ai/mcp";
const BASE_URL = MCP_URL.replace(/\/mcp$/, "");
const REDIRECT_URI = "http://localhost:19876/callback"; // Not actually opened; we intercept the 302

// ─── Helpers ────────────────────────────────────────────────
function base64url(buf) {
  return buf.toString("base64url");
}

function sha256(str) {
  return createHash("sha256").update(str).digest();
}

// ─── OAuth 2.1 + DCR + PKCE (headless, no browser) ─────────
async function obtainAccessToken() {
  // 1) Dynamic Client Registration
  console.error("[domovina-proxy] Registering OAuth client via DCR...");
  const dcrRes = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "antigravity-domovina-proxy",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!dcrRes.ok) throw new Error(`DCR failed: ${dcrRes.status} ${await dcrRes.text()}`);
  const clientInfo = await dcrRes.json();
  const clientId = clientInfo.client_id;
  console.error(`[domovina-proxy] Got client_id: ${clientId}`);

  // 2) PKCE code_verifier + code_challenge
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(sha256(codeVerifier));

  // 3) Hit /authorize — server auto-approves and 302s with code in Location header
  const authUrl = new URL(`${BASE_URL}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", "mcp");

  console.error("[domovina-proxy] Requesting authorization code...");
  const authRes = await fetch(authUrl.toString(), { redirect: "manual" });

  if (authRes.status < 300 || authRes.status >= 400) {
    throw new Error(`Authorize failed: expected 302, got ${authRes.status}`);
  }

  const location = authRes.headers.get("location");
  if (!location) throw new Error("Authorize 302 but no Location header");

  const locUrl = new URL(location);
  const authCode = locUrl.searchParams.get("code");
  if (!authCode) throw new Error(`No code in Location: ${location}`);
  console.error(`[domovina-proxy] Got authorization code: ${authCode.substring(0, 8)}...`);

  // 4) Exchange code for tokens
  const tokenRes = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);

  const tokens = await tokenRes.json();
  console.error(`[domovina-proxy] Got access_token (expires_in: ${tokens.expires_in}s)`);
  return tokens.access_token;
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  // Get a valid access token via full OAuth flow
  const accessToken = await obtainAccessToken();

  // Set up the client transport to the remote Domovina server
  const clientTransport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });

  // Create the MCP Client
  const client = new Client(
    { name: "antigravity-bridge", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(clientTransport);
    console.error("[domovina-proxy] Connected to remote Domovina MCP server");
  } catch (err) {
    console.error("[domovina-proxy] Failed to connect:", err.message);
    process.exit(1);
  }

  // Create the local stdio Server
  const server = new Server(
    { name: "domovina-proxy", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Forward tools/list
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return await client.listTools(request.params);
  });

  // Forward tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
    });
  });

  const serverTransport = new StdioServerTransport();
  await server.connect(serverTransport);
  console.error("[domovina-proxy] Domovina MCP proxy running on stdio");
}

main().catch((err) => {
  console.error("[domovina-proxy] Fatal error:", err);
  process.exit(1);
});
