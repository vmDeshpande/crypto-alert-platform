# Security

Read [SECURITY.md](../SECURITY.md) first — that is the short version, and it
explains how to report a vulnerability. This document covers the design.

## Threat model

Crypto Sentinel is a **single-operator** tool. One person, one dashboard
password, one exchange account. It is not multi-tenant and does not attempt to
be.

That framing matters, because it determines what is protected and what is
simply out of scope:

| Asset | Attacker wants it to… |
|---|---|
| `ENCRYPTION_KEY` | Decrypt exchange API keys and trade or withdraw |
| `ALERT_API_KEY` | Drive the pipeline, spam notifications, read alerts |
| `APP_PASSWORD_HASH` | Learn or brute-force the dashboard password |
| `notification_channels.config` | Abuse a Discord/Telegram bot or webhook |
| Dashboard access | Read and modify watchlists and alerts |
| Database contents | The above, plus all price history |

Out of scope: multi-user isolation, per-alert permissions, and protection
against an attacker who already has your database and your environment
variables. If they have those, they have the keys.

## Authentication

### Dashboard — session cookies

`proxy.ts` runs on the edge and gates every UI route except `/login`.

The gate activates only when `APP_PASSWORD_HASH` is set. Sessions are
**stateless**: the cookie holds `{ sid, exp }` signed with HMAC-SHA256, and
nothing is stored server-side.

Signing uses Web Crypto (`lib/cookie-signature.ts`) rather than `node:crypto`
specifically so the same code verifies in the edge middleware and in Node
server actions.

Cookie flags:

| Flag | Value | Reason |
|---|---|---|
| `httpOnly` | `true` | Not readable from JavaScript, so XSS cannot exfiltrate it |
| `sameSite` | `lax` | Limits CSRF on cross-site requests |
| `secure` | production only | Requires HTTPS |
| `path` | `/` | |
| `maxAge` | 30 days | |

Consequences of a stateless design:

- Sessions survive restarts and work across serverless instances — the reason
  for choosing it.
- **Sessions cannot be revoked before they expire.** Changing
  `SESSION_SECRET` invalidates every session at once; that is the only lever.
- Anyone who obtains the signing secret can mint sessions.

### Password

`lib/password.ts` compares the submitted password against
`APP_PASSWORD_HASH` with `bcrypt.compare` (cost 10). A missing hash means "no
protection requested", not "match anything" — `validatePassword` returns `true`
because there is nothing to check, and `proxy.ts` skips the gate entirely in
that case.

There is no rate limiting on `/login`. Put one in your reverse proxy.

### Internal API — bearer token

`lib/api-auth.ts` guards every `/api/*` route except the health endpoint using
`Authorization: Bearer $ALERT_API_KEY`, compared with
`crypto.timingSafeEqual` after a length check.

The check **skips in development when the variable is unset** so you can drive
endpoints from a terminal, and **fails closed in production**. This is the
opposite of the previous behaviour, where an unset key silently opened every
route.

The cron orchestrator uses the same token for its internal stage calls, which is
why those routes are bearer-guarded rather than cookie-guarded.

### What was fixed during the public-release cleanup

These were live issues and are worth knowing about if you read older advice:

| Issue | Resolution |
|---|---|
| `proxy.ts` checked `APP_PASSWORD`, but the password lives in `APP_PASSWORD_HASH` — the gate never activated | Both now read `APP_PASSWORD_HASH` |
| The middleware only checked that a cookie existed, never that it was valid | The signature and expiry are verified |
| Sessions were held in an in-memory `Map`, so they died on restart and never worked across serverless instances | Stateless signed cookies |
| `/api/alerts` and `/api/ai/insights` had no authentication at all | Both now use the bearer guard |
| Internal routes skipped the check whenever `ALERT_API_KEY` was unset | Fails closed in production |

## Secret handling

| Secret | Storage | Encryption |
|---|---|---|
| Delta Exchange key/secret | `api_credentials` | **AES-256-GCM** |
| Session signing key | Environment only | n/a |
| API bearer token | Environment only | n/a |
| Discord webhook URL, Telegram bot token, email address | `notification_channels.config` | **Plaintext JSON** |

That asymmetry is deliberate but worth restating: **exchange credentials are
encrypted; notification credentials are not.** The reasoning is that exchange
keys can move funds while a Discord webhook mostly cannot, so the higher-value
secret gets the protection.

If you need both encrypted, extend `lib/encryption.ts` to the channels table.
Note that the webhook URL is also copied into `webhook_logs.payload` — actually,
only the alert ID is stored there, but the URL is stored in `webhook_logs.webhook_url`
in plaintext.

### Credential encryption

AES-256-GCM, implemented in `lib/encryption.ts`.

- Key comes from `ENCRYPTION_KEY`: a 64-char hex string is used verbatim,
  anything else is scrolled through scrypt to 32 bytes.
- Output is `iv || authTag || ciphertext`, all hex.
- A fresh 12-byte IV per encryption.
- GCM's auth tag means a wrong key or tampered ciphertext **throws** rather than
  returning garbage.
- Startup throws in production if `ENCRYPTION_KEY` is unset. Outside production
  it falls back to a fixed development key.

`ENCRYPTION_KEY` doubles as the session signing fallback when `SESSION_SECRET`
is unset. Setting both is better practice: it isolates key rotation so you can
change one without breaking the other.

### Rotating `ENCRYPTION_KEY`

Existing `api_credentials` rows become undecryptable. There is no re-encryption
migration. Record the rotation, re-enter the exchange credentials through the
UI, and keep a database backup from before the change in case you need to roll
back.

The `deltaExchange` health check reports `unhealthy` with a decryption error
afterwards, which is the fastest way to confirm.

## Transport

The app does not terminate TLS. Expect a platform (Vercel) or a reverse proxy
(Caddy, nginx, Traefik) in front of it.

Session cookies set `Secure` in production, so an HTTPS-only deployment is
effectively enforced: a plain HTTP instance cannot keep a login.

## Input validation

Every write goes through a Zod schema in `lib/schemas.ts` before touching the
database. Server Actions and API routes both parse with it.

One caveat: **Zod does not bound array lengths.** `symbols` and
`notificationChannels` accept arbitrarily many entries, and `alerts.symbol` is a
`varchar(50)` that the database will reject rather than the application.

## The health endpoint

`/api/system/health` is deliberately unauthenticated so uptime monitors can
reach it without credentials.

It exposes no secrets. Credentials are decrypted only to make a ticker call and
are never serialised; indicator test values come from public candle data.

It does expose configuration shape:

- whether credentials, watchlists, alerts and a Discord webhook exist
- how many symbols are tracked
- current prices, volumes and pool statistics

On a private network that is harmless. On a public deployment, restrict the
route to your monitoring network or place an authenticating proxy in front of
it. If you restrict it, remember that external cron services do not call it —
only monitors do.

## Secret exposure in version control

The original repository had a `.env` containing a live database password, the
encryption key and the API key in plaintext, committed without being
gitignored. `.env.example` is committed instead, and `.gitignore` covers `.env`
and `.env.*` with `!.env.example`.

**Rotate everything that was ever in that file.** Removing a secret from the
working tree does not remove it from history — the values should be considered
public.

If you fork or mirror this repository, confirm no `.env` file exists anywhere
in history before publishing:

```bash
git log --all --full-history -- .env
git rev-list --all --objects | grep -i '\.env$'
```

## Remaining gaps

Honest list, in rough priority order:

1. **No rate limiting** anywhere — login or API. Add one at the proxy.
2. **No automated tests** on authentication or authorisation paths.
3. **Single shared password**, no second factor. Appropriate for the scope; a
   concern if you expose it widely.
4. **Sessions cannot be revoked** individually.
5. **Webhook URLs are stored and logged in plaintext.**
6. **No CSP header.** `next.config.mjs` sets `X-Content-Type-Options`,
   `X-Frame-Options` and `Referrer-Policy`, but a Content-Security-Policy would
   need to account for `next/font` and inline styles.
7. **No audit log** of who changed what. There is only one user, and no
   `updated_by` columns.
8. **`APP_URL` is not validated**, so a misconfigured value posts the bearer
   token to whatever host it names. Treat it as trusted configuration.

## Hardening checklist

Before exposing a deployment:

1. `APP_PASSWORD_HASH` set
2. `ALERT_API_KEY` long, random, and different from any development value
3. `SESSION_SECRET` set explicitly
4. HTTPS terminated in front of the app
5. Database reachable only from the app, ideally over TLS
6. Rate limiting on `/api/*` and `/login`
7. `/api/system/health` restricted if publicly reachable
8. Pooled `DATABASE_URL` on serverless
9. Backups taken, **with a note that `ENCRYPTION_KEY` must be preserved**
10. Repository secret scan clean (`git log`, dependency audit)