# Configuration

All configuration is environment-based. Copy [`.env.example`](../.env.example)
to `.env.local` — `.env` and every `.env.*` variant except `.env.example` are
gitignored.

## Required

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Use the **pooled** string from your provider on serverless. The app opens a `pg` pool per instance. |
| `ALERT_API_KEY` | Bearer token for the internal API and cron endpoint | The only credential standing between the internet and your pipeline. 32 random bytes as hex. |
| `ENCRYPTION_KEY` | AES-256-GCM key for exchange credentials at rest | 64-character hex. Startup fails in production without it. |

## Optional

| Variable | Purpose | Default when unset |
|---|---|---|
| `APP_PASSWORD_HASH` | bcrypt hash gating the dashboard | Dashboard is **open** — set this before exposing the app |
| `SESSION_SECRET` | HMAC key for the session cookie | Falls back to `ENCRYPTION_KEY`, then a fixed dev value. Production refuses to sign cookies without one of the first two. |
| `ANTHROPIC_API_KEY` | Enables `/api/ai/insights` | Endpoint returns `503` |
| `APP_URL` | Public base URL the cron route calls itself on | Falls back to `VERCEL_*`, then `http://localhost:3000` in development. Outside development with no URL set, the cron route returns `500`. |

## Platform-provided

| Variable | Set by | Used for |
|---|---|---|
| `NODE_ENV` | Runtime | Enables production strictness (key requirements, secure cookies, fail-closed API auth) |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel | Preferred base URL for the cron route |
| `VERCEL_URL` | Vercel | Preview deployment base URL |

## Generating secrets

```bash
# ALERT_API_KEY and ENCRYPTION_KEY — 32 random bytes, hex encoded
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# APP_PASSWORD_HASH — cost 10 matches lib/password.ts
node -e "require('bcryptjs').hash('your-password', 10).then(h => console.log(h))"
```

## How the values are used

### `ENCRYPTION_KEY`

A 64-character hex string is used verbatim as the AES-256 key. Anything else is
run through scrypt to produce a 32-byte key, so a passphrase works too.

It encrypts only the Delta Exchange API key and secret, stored as
`iv || authTag || ciphertext` hex in `api_credentials`.

**Rotating it makes existing rows unreadable.** Re-enter your exchange
credentials after changing it. There is no re-encryption migration.

### `APP_PASSWORD_HASH`

A bcrypt hash compared by `lib/password.ts`. `proxy.ts` checks that the
*variable* is present to decide whether to gate routes at all.

Omit it only for a deployment on a network you control exclusively.

### `ALERT_API_KEY`

Compared against the `Authorization: Bearer <key>` header by `lib/api-auth.ts`
using a constant-time comparison. In development the check is skipped when the
variable is unset so you can drive endpoints from a terminal; **in production an
unset key rejects every API request.**

### `APP_URL`

The cron orchestrator does not import the pipeline stages — it makes HTTP
requests to your own deployment. That requires a URL reachable from inside the
deployment. Self-hosted deployments on a private network must set this to a
resolvable address, or use `vercel.json` crons on Vercel where the variable
already exists.

## Application-level settings

Two things are stored in the database rather than the environment, because they
change per install and are edited through the UI:

| Data | Table | Notes |
|---|---|---|
| Exchange credentials | `api_credentials` | Encrypted; the dashboard lists only metadata |
| Notification channels | `notification_channels` | `config` JSON holds webhook URLs, bot tokens or addresses |

Everything else — watchlists, alerts, prices, indicators, logs — is operational
data you can safely delete and let the pipeline rebuild.

## Tuning

There is no settings UI for these; edit the constants at the top of the relevant
file.

| Behaviour | Constant | File |
|---|---|---|
| Candle interval and window | `CANDLE_INTERVAL_SECONDS`, `CANDLE_LIMIT` | `app/api/data/collect-prices/route.ts` |
| Price retention | `RETENTION_DAYS` | `app/api/data/collect-prices/route.ts` |
| Alert cooldown | `COOLDOWN_MS` | `app/api/alerts/evaluate/route.ts` |
| RSI / EMA / MACD periods | `DEFAULT_RSI_PERIOD`, `FAST_EMA_PERIOD`, `SLOW_EMA_PERIOD`, `SIGNAL_PERIOD` | `lib/indicators.ts` |
| Stale-price threshold | `STALE_PRICE_HOURS` | `app/api/system/health/route.ts` |
| Session lifetime | `SESSION_DURATION_MS` | `lib/session.ts` |

Keep indicator periods and the collection window consistent: MACD needs at
least 26 candles, and the evaluator reads the last 50.