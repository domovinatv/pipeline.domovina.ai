# Admin prijava — Cloudflare Access (kod na e-mail) + passkey

`https://pipeline.domovina.ai/admin`. Zamjenjuje Basic Auth (v0.19.0, 2026-10-10).
Kod je prenesen iz `pay.domovina.ai` (`backend/src/admin/auth/`, `docs/admin-auth.md`
tamo), a tamo iz `bank-push-gateway`. Sva tri treba držati u skladu.

## Dva puta ulaska, jedna sesija

```mermaid
flowchart LR
  L[/admin/login/] -->|Prijava passkeyem| P[/admin/passkey/login/verify/]
  L -->|Prijava preko Accessa| S[/admin/sso/]
  S -->|Cloudflare Access: kod na e-mail<br/>samo e-mailovi iz politike| S
  P --> Sess[(admin_sessions)]
  S -->|JWT potpis + issuer + AUD ok<br/>i e-mail u ADMIN_EMAILS| Sess
  Sess --> A[/admin/*]
```

- **Cloudflare Access** štiti samo `/admin/sso` (aplikacija „Pipeline admin (sso)",
  politika „Pipeline admini", IdP One-time PIN, sesija 24 h). Nema lozinki.
- **Passkey** se dodaje nakon prvog ulaska preko Accessa (🔑 Passkeyi → Dodaj passkey).
  Vrijedi samo za `pipeline.domovina.ai`; passkeyi s `mpt.domovina.ai` ovdje ne rade.
- Access je ujedno **oporavak** ako se izgube svi passkeyi.

## Što nije pod admin prijavom

| Put | Auth |
|---|---|
| `/dashboard`, `/api/v1/*` | API ključ korisnika (`pdk_…`); dashboard ga drži u kolačiću `__Host-pipeline_key` |
| `/api/jobs/*`, `/api/discovered`, `/api/usage`, `/api/magisterium` | Bearer `INGEST_KEY` (bridge na Mac Miniju) |
| `/api/transcription/*` | Bearer `INGEST_KEY` ili `TRANSCRIBE_KEY` (Colab) |

## Sigurnost (isto kao pay)

| Mjera | Gdje |
|---|---|
| Sesija: 32 nasumična bajta u `__Host-pipeline_admin` (HttpOnly, Secure, SameSite=Lax, 12 h, 2 h neaktivnosti); u D1 samo sha-256 | `admin/auth/session.ts` |
| E-mail se pri svakom zahtjevu provjerava protiv `ADMIN_EMAILS` | `getSession` |
| CSRF: svaki POST mora imati `Origin` jednak originu admina | `admin/auth/mount.ts` |
| WebAuthn izazov jednokratan, 5 min, vezan uz svrhu i e-mail | `consumeChallenge` |
| Admin samo na `ADMIN_HOST`; drugi host → 301 (GET) ili 421 | `mount.ts` |
| CSP s nonceom na svaki inline `<script>`; inline handleri (`onclick=`, `onsubmit=`) blokirani | `mount.ts` |
| `/admin/api/*` bez sesije → 401; Basic Auth zaglavlje ništa ne otvara | `mount.ts`, `test/admin-auth.test.ts` |
| Dodavanje passkeya: prijava mlađa od 10 min, najviše 5 po e-mailu, zapis `admin_passkey_added` u logu | `mount.ts` |
| Istekle sesije i izazovi brišu se u cronu (*/15) | `src/index.ts` |

**Razlike od pay:** CSP dodatno pušta `img-src https://i.ytimg.com` (sličice videa) i
`connect-src https://www.youtube.com` (oEmbed preview u formi). Novi passkey ide samo u
log (pipeline nema Telegram alarm).

## Konfiguracija

`backend/wrangler.toml` → `[vars]` (nisu tajne): `ADMIN_EMAILS`, `ADMIN_HOST`,
`ACCESS_TEAM_DOMAIN` (`domovina.cloudflareaccess.com`), `ACCESS_AUD`.

Access aplikacija je napravljena preko API-ja dashboarda, jer wrangler OAuth token nema
Access scope: iz prijavljenog taba na `dash.cloudflare.com/<account>/one/settings`
`fetch('/api/v4/accounts/<account>/access/apps', { method: 'POST', headers:
{'content-type':'application/json','x-cross-site-security':'dash'}, body })` s inline
`policies`. Odgovor vraća `aud`.

**Oduzimanje pristupa:** makni e-mail iz `ADMIN_EMAILS` (djeluje odmah, i na postojeće
sesije) i iz Access politike.

**Nakon deploya v0.19.0:** `ADMIN_USER` / `ADMIN_PASS` se više ne čitaju i obrisani su
(`wrangler secret delete`).

## Ops pozivi admin API-ja

`curl -u` više ne radi. Admin API zove se iz preglednika s prijavljenom sesijom, npr. u
konzoli na `https://pipeline.domovina.ai/admin`:

```js
await fetch('/admin/api/jobs?limit=5').then((r) => r.json())
```

Bridge ništa ne zove pod `/admin` (sve ide na `/api/*` s `INGEST_KEY`).

## Lokalno

```bash
cd backend
npm run db:migrate:local
npx wrangler dev --local-upstream localhost
```

Access lokalno ne radi. Za lokalnu sesiju upiši je ručno u lokalni D1 (`admin_sessions`,
`token_hash` = sha-256 tokena, `expires_at` u budućnosti) i postavi kolačić
`__Host-pipeline_admin=<token>`. Passkey radi na `http://localhost`.
