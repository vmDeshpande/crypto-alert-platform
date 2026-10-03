# Architecture

## What the system does

Crypto Sentinel is a scheduled evaluation loop. Every cron cycle it:

1. asks Delta Exchange for recent candles on each watched symbol,
2. recomputes technical indicators from that data and stores them,
3. evaluates each active alert rule against the freshest values,
4. delivers a notification to each channel attached to a triggered alert.

There is no long-lived process and no in-memory state between cycles. Everything
the system needs lives in PostgreSQL, and any scheduler can drive it over HTTP.

## Pipeline

```
external cron (EasyCron, EventBridge, crontab, ...)
   │  POST /api/cron/evaluate-alerts
   │  Authorization: Bearer $ALERT_API_KEY
   ▼
┌──────────────────────────────────────────────────────────────┐
│ app/api/cron/evaluate-alerts                                 │
│  resolves base URL, then calls three stages over HTTP        │
└──────────────────────────────────────────────────────────────┘
   │
   ├─▶ ① POST /api/data/collect-prices
   │      watchlists → unique symbols
   │      Delta /history/candles  ──▶  price_history   (new rows only)
   │      lib/indicators           ──▶  indicator_data  (rsi/ema12/ema26/macd)
   │      retention prune         ──▶  DELETE price_history older than 365d
   │
   ├─▶ ② POST /api/alerts/evaluate
   │      active alerts  ──▶  price_history (last 50) + indicator_data (last 4)
   │      per alert: cooldown check → condition → optional second condition
   │      on trigger: INSERT alert_logs, UPDATE alerts.last_triggered_at
   │
   └─▶ ③ POST /api/notifications/send   (once per triggered alert)
          notification_channels filtered by channelIds
          discord / telegram / email / webhook  ──▶  webhook_logs
```

### Why HTTP between stages

The orchestrator calls its own endpoints rather than importing the stage
functions. Three consequences worth knowing:

- Each stage is independently callable and testable with `curl`.
- A stage failure is isolated: collection errors are reported but evaluation
  still runs.
- **The deployment must be able to reach its own public URL.** Without
  `APP_URL` (or a Vercel variable) the route returns `500`. This is the single
  most common self-hosting mistake.

## Request boundaries

Two independent authentication mechanisms cover disjoint paths.

```
browser ──▶ proxy.ts ──────────────▶ /, /watchlists, /alerts, /settings, …
             signed httpOnly session cookie
             only enforced when APP_PASSWORD_HASH is set

cron   ──▶ /api/cron/*            ┐
cron   ──▶ /api/data/*            ├── lib/api-auth.ts  (ALERT_API_KEY bearer)
cron   ──▶ /api/alerts/evaluate   │
cron   ──▶ /api/notifications/*   ┘
cron   ──▶ /api/alerts, /api/ai/*    same guard

anyone ──▶ /api/system/health     no auth, by design (uptime monitors)
```

The internal calls in step 1–3 pass the same `ALERT_API_KEY` the cron service
uses, which is why those routes are bearer-guarded rather than cookie-guarded.

## Module map

| Path | Responsibility |
|---|---|
| `proxy.ts` | Edge middleware. Redirects unauthenticated UI requests to `/login` |
| `app/page.tsx` | Dashboard — aggregates alert and trigger statistics |
| `app/actions/` | Server Actions invoked directly from client components |
| `app/api/cron/evaluate-alerts/` | Pipeline orchestrator |
| `app/api/data/collect-prices/` | Stage 1 — exchange fetch, indicator computation, retention |
| `app/api/alerts/evaluate/` | Stage 2 — condition evaluation and trigger logging |
| `app/api/notifications/send/` | Stage 3 — channel dispatch |
| `app/api/ai/insights/` | Optional Claude commentary |
| `app/api/system/health/` | Parallel subsystem checks |
| `lib/db/schema.ts` | Table definitions, single source of truth for structure |
| `lib/db/index.ts` | `pg` pool and Drizzle instance |
| `lib/indicators.ts` | RSI, EMA, MACD — the only place indicator maths lives |
| `lib/delta-exchange.ts` | Delta REST client with HMAC-SHA256 signing |
| `lib/encryption.ts` | AES-256-GCM for credential storage |
| `lib/session.ts` | Session constants shared by Node and edge code |
| `lib/cookie-signature.ts` | Web Crypto HMAC sign/verify for cookies |
| `lib/auth.ts` | Session lifecycle and password validation |
| `lib/password.ts` | bcrypt comparison against `APP_PASSWORD_HASH` |
| `lib/api-auth.ts` | Bearer-token guard for `/api/*` |
| `lib/schemas.ts` | Zod input schemas and the condition catalogue |
| `lib/utils.ts` | `cn()` class-name helper |
| `drizzle.config.ts` | Drizzle Kit configuration |

## Data flow conventions

**Timestamps.** Candles are stored oldest-first and evaluated with an explicit
`ORDER BY timestamp DESC` + `reverse()`. Delta returns newest-first; the client
sorts on the way in so no caller has to remember that.

**Incremental collection.** `collect-prices` compares the newest stored candle
against the newest available candle and inserts only what is missing. Running it
more often than new candles appear is a no-op, which is what makes a 5-minute
cron cheap.

**Indicator snapshots, not streams.** Every collection run recomputes indicators
over the 50-candle window and writes one row per indicator. Evaluators read the
latest rows; they never recompute. The trade-off is documented in
[alerts.md](alerts.md#indicator-fidelity).

**Cooldown.** A triggered alert cannot fire again for 5 minutes
(`COOLDOWN_MS`), tracked with `alerts.last_triggered_at`. Without it an alert
sitting above its threshold would notify on every cron cycle.

## Design decisions

| Decision | Rationale | Cost |
|---|---|---|
| Stateless signed session cookies | Works on serverless and across restarts without shared session storage | Cannot revoke a session before it expires (30 days) |
| Single shared dashboard password | Matches single-operator scope; no user table needed | Not multi-user; anyone who logs in sees everything |
| Bearer token shared by cron and internal stages | One secret to provision; internal calls stay uniform | Anyone holding `ALERT_API_KEY` can drive the pipeline |
| Indicators recomputed per run | Simple, stateless, no incremental-state corruption | Values shift as the window slides — see [alerts.md](alerts.md#indicator-fidelity) |
| Simplified indicator formulas | No TA dependency; readable and auditable | Not canonical Wilder/EMA-MACD |
| Stages invoked over HTTP | Independently testable and deployable | Needs a self-reachable URL |
| No internal scheduler | No background process to keep alive; any provider works | Nothing fires unless something calls the endpoint |

## Extension points

- **Another exchange** — implement the client surface used by
  `collect-prices` (`getCandles`) in a new module and add an `exchange` value.
  `api_credentials.exchange` is already stored per row.
- **More indicators** — add to `lib/indicators.ts`, write the rows in
  `collect-prices`, read them in `evaluate`, then extend `CONDITION_TYPES`.
- **More channels** — see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-notification-channel).
- **Longer or shorter intervals** — pass a different `interval` to
  `getCandles`. The evaluator reads 50 candles regardless, so keep the window
  at least as long as the indicator periods require.