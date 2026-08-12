# MCP Proxy Bridges — Antigravity / Claude Code integracija

Ovaj direktorij sadrži **stdio ↔ remote** MCP proxy bridgeove koji omogućuju
AI coding alatima (Antigravity CLI, Claude Code, Cursor, itd.) pristup
eksternim MCP serverima koji koriste HTTP/SSE transport ili nestandardne API-je.

## Zašto postoje?

AI coding alati pokreću MCP servere kao **stdio subprocesse** — šalju JSON-RPC
poruke kroz stdin/stdout. Međutim, remote MCP serveri (Domovina, Magisterium)
koriste HTTP-bazirane transportne protokole (Streamable HTTP, A2A) s OAuth
autentifikacijom. Proxy bridgeovi premošćuju tu razliku:

```
┌─────────────────┐     stdio      ┌──────────────┐    HTTPS + OAuth     ┌─────────────────┐
│  Antigravity CLI │ ◄──────────►  │  proxy .mjs  │ ◄──────────────────► │  Remote MCP srv  │
│  (ili Claude)    │   JSON-RPC    │  (ovaj repo)  │   StreamableHTTP    │  (produkcija)    │
└─────────────────┘               └──────────────┘    ili A2A           └─────────────────┘
```

---

## Domovina MCP (`domovina-mcp.mjs`)

**Remote endpoint:** `https://mcp.domovina.ai/mcp`
**Protokol:** MCP Streamable HTTP (JSON-RPC over HTTP POST + SSE)
**Auth:** OAuth 2.1 + DCR + PKCE (auto-approve, headless)

### Kako radi

1. **Dynamic Client Registration (DCR)** — POST na `/register`, dobije `client_id`
2. **PKCE Authorization** — GET na `/authorize` s `code_challenge` (S256).
   Server auto-approveuje i vraća `302 Found` s `?code=...` u Location headeru.
   Nema browser interakcije — proxy intercepta 302 s `redirect: "manual"`.
3. **Token Exchange** — POST na `/token` s `code + code_verifier`, dobije
   `access_token` (7 dana TTL) + `refresh_token`
4. **MCP Forwarding** — `StreamableHTTPClientTransport` s Bearer tokenom
   prosljeđuje `tools/list` i `tools/call` pozive na produkcijski server

### Root cause prijašnjeg 500 errora

Lokalni Docker deployment koristi `MCP_API_KEY` koji se seeda u lokalnu PG bazu
(`oauth_access_tokens` tablica, hashiran SHA-256). **Produkcijski Coolify
deployment koristi drugu PG instancu** gdje taj API key nikada nije seedan.

Kada je proxy slao sirovi Bearer token (lokalni API key), produkcijski
`requireBearerAuth` middleware je:
1. Hashirao token → SHA-256
2. Tražio hash u produkcijskoj PG bazi → `rowCount === 0`
3. Bacio `throw new Error("Invalid access token")`
4. SDK `requireBearerAuth` to uhvatio kao **500 Internal Server Error**
   (umjesto 401) jer SDK tretira generic Error throwove kao server error

**Rješenje:** Koristiti puni OAuth 2.1 flow (identično kao Claude Code) umjesto
sirovog API keyja. OAuth DCR + PKCE registrira klijenta i dobije token koji
postoji u produkcijskoj PG bazi.

### Konfiguracija

```jsonc
// ~/.gemini/config/mcp_config.json
{
  "domovina": {
    "command": "node",
    "args": ["/Users/ms/git/domovinatv/pipeline.domovina.ai/domovina-mcp.mjs"],
    "type": "stdio"
  }
}
```

Env varijabla `DOMOVINA_MCP_URL` overridea default URL (za staging/dev).

### Troubleshooting

| Simptom | Uzrok | Fix |
|---------|-------|-----|
| `500 Internal Server Error` | Token ne postoji u produkcijskoj PG bazi | Koristiti OAuth flow (default u skripti) |
| `401 invalid_token` | Token istekao (7 dana TTL) | Restart proxy — automatski dohvaća novi |
| `fetch failed` | Antigravity koristi cachan stari subprocess | Restart Antigravity prozora |
| `406 Not Acceptable` | Nedostaje `Accept: application/json, text/event-stream` header | SDK ovo automatski šalje |

---

## Magisterium MCP (`magisterium-mcp.mjs`)

**Remote endpoint:** `https://www.magisterium.com/api/v1/a2a`
**Protokol:** Google A2A (Agent-to-Agent) — JSON-RPC `message/send`
**Auth:** Bearer token (Supabase auth — `sb-*-auth-token` cookie)

### Kako radi

Magisterium nema standardni MCP server. Umjesto toga, ima **A2A endpoint**
koji prima JSON-RPC `message/send` poruke sa `skillId` metadatom. Proxy:

1. Čita Bearer token iz `.magisterium_token` datoteke
2. Definira 9 MCP toolova koji mapiraju na Magisterium skillove:
   `catholic_qa`, `document_search`, `document_fetch`, `liturgical_readings`,
   `saints_of_the_day`, `saint_lookup`, `person_lookup`, `pope_lookup`,
   `diocese_lookup`
3. Svaki `tools/call` pretvara u A2A `message/send` request s odgovarajućim
   `skillId` i šalje na `https://www.magisterium.com/api/v1/a2a`
4. Parsira odgovor iz `result.artifacts[0].parts[0].text` ili
   `result.history[-1].parts[0].text`

### Token nabavka

Token dolazi iz Supabase auth cookieja (`sb-lqjzgrhahlmoghragxvl-auth-token`).
Cookie je split u `.0` i `.1` chunkove. `parse-cookies.mjs` ih spaja i
ekstrahira `access_token`. Rezultat se sprema u `.magisterium_token`.

```bash
# Obnovi token (kad istekne):
node parse-cookies.mjs < .magisterium_cookies.txt
# Ili ručno: kopiraj access_token iz JSON-a cookieja
```

### Konfiguracija

```jsonc
// ~/.gemini/config/mcp_config.json
{
  "magisterium": {
    "command": "node",
    "args": ["/Users/ms/git/domovinatv/pipeline.domovina.ai/magisterium-mcp.mjs"],
    "type": "stdio"
  }
}
```

---

## Potpuna `mcp_config.json` referenca

```jsonc
// ~/.gemini/config/mcp_config.json
{
  "mcpServers": {
    "domovina": {
      "command": "node",
      "args": ["/Users/ms/git/domovinatv/pipeline.domovina.ai/domovina-mcp.mjs"],
      "type": "stdio"
    },
    "magisterium": {
      "command": "node",
      "args": ["/Users/ms/git/domovinatv/pipeline.domovina.ai/magisterium-mcp.mjs"],
      "type": "stdio"
    },
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "type": "stdio"
    }
  }
}
```

---

## Datoteke u ovom direktoriju

| Datoteka | Svrha |
|----------|-------|
| `domovina-mcp.mjs` | Stdio↔StreamableHTTP proxy za Domovina MCP (OAuth 2.1 + DCR + PKCE) |
| `magisterium-mcp.mjs` | Stdio↔A2A proxy za Magisterium AI (Supabase Bearer token) |
| `parse-cookies.mjs` | Ekstrahira Supabase `access_token` iz cookie JSON-a |
| `magisterium-auth.mjs` | Pomoćna skripta za Magisterium autentifikaciju |
| `.magisterium_token` | Trenutni Bearer token za Magisterium **(gitignored)** |
| `.magisterium_cookies.txt` | Raw cookie dump **(gitignored)** |

---

## Dependency

Oba proxyja koriste `@modelcontextprotocol/sdk` (već u `package.json`).
Nema dodatnih dependencyja — OAuth flow koristi native Node `crypto` i `fetch`.

## Razlika: lokalni Docker vs. produkcija

| Aspekt | Lokalni Docker (`localhost:3000`) | Produkcija (`mcp.domovina.ai`) |
|--------|-----------------------------------|--------------------------------|
| PG baza | `postgres:5432/rag` (Docker compose) | Coolify-managed PG instanca |
| API key | Seedan putem `MCP_API_KEY` env var | **NIJE seedan** — koristi OAuth |
| PUBLIC_BASE_URL | `https://...ngrok-free.app` | `https://mcp.domovina.link` |
| Auth metoda | Bearer s API keyjem ILI OAuth | **Samo OAuth** (DCR + PKCE) |
| Issuer | ngrok URL | `mcp.domovina.link` |

**Pravilo:** Za produkciju UVIJEK koristi OAuth 2.1 flow, nikad sirovi API key.
