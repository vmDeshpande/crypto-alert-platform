# Crypto Sentinel

Self-hosted cryptocurrency price and technical-indicator alerting, built on
[Delta Exchange](https://delta.exchange) market data.

Define alert rules against watchlisted symbols, and Crypto Sentinel collects
candles on a schedule, recomputes RSI/EMA/MACD, evaluates your conditions, and
pushes the result to Discord, Telegram or any webhook.

<!-- Screenshot placeholder: add a dashboard screenshot under docs/images/ -->

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Alert conditions](#alert-conditions)
- [How the pipeline works](#how-the-pipeline-works)
- [Stack](#stack)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Documentation](#documentation)
- [Security](#security)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## What it does

- **Watchlists** — group tracked symbols into named collections.
- **Alerts** — price thresholds, percentage moves, volume spikes, RSI
  overbought/oversold, MACD histogram and EMA crossover, with an optional second
  condition combined by `AND`/`OR`.
- **Indicators** — RSI(14), EMA(12)/EMA(26) and MACD computed in-process from
  collected candles. No TA dependency.
- **Notifications** — Discord webhooks, Telegram bots, generic HTTP webhooks,
  and an email stub. Multiple channels per alert, independently reported.
- **Encrypted credentials** — exchange API keys stored with AES-256-GCM.
- **Password-protected dashboard** — optional bcrypt gate with signed
  `httpOnly` session cookies.
- **Health endpoint** — six parallel subsystem checks, suitable for uptime
  monitoring.
- **AI insights** — optional Claude commentary on price action and alert
  performance.

## Quick start

**Requirements:** Node.js 20.11+, a PostgreSQL database, and (for live data) a
Delta Exchange API key.

```bash
git clone https://github.com/<owner>/crypto-sentinel.git
cd crypto-sentinel
npm install
cp .env.example .env.local     # fill in DATABASE_URL, ALERT_API_KEY, ENCRYPTION_KEY
npm run db:migrate
npm run dev
```

Generate the two required secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then configure the app, in this order:

1. **Settings → API Credentials** — your Delta Exchange key/secret (encrypted on
   save).
2. **Watchlists** — add symbols such as `BTCUSD`. This list is the only input to
   price collection.
3. **Settings → Notifications** — register a channel. A Discord webhook is the
   quickest to verify.
4. **Alerts → Create Alert** — pick the watchlist, symbol, condition and
   channels.

Trigger a cycle manually to see it work:

```bash
curl -X POST http://localhost:3000/api/cron/evaluate-alerts \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

You should see `"collected": 1` or more. Check overall state with:

```bash
curl -s http://localhost:3000/api/system/health | jq '{status, summary}'
```

**Nothing fires on its own.** Crypto Sentinel has no internal scheduler — point
an external cron service at the endpoint above. See
[docs/deployment.md](docs/deployment.md#scheduling).

Full walkthrough: [docs/installation.md](docs/installation.md).

## Alert conditions

| Condition | Fires when | Threshold |
|---|---|---|
| `price_above` | Latest close is above the threshold | required |
| `price_below` | Latest close is below the threshold | required |
| `price_change_percent` | Close-to-close move exceeds the threshold | required |
| `volume_spike` | Volume exceeds the threshold % above the 10-candle average | default 50 |
| `rsi_overbought` | RSI(14) is above the threshold | default 70 |
| `rsi_oversold` | RSI(14) is below the threshold | default 30 |
| `moving_average_cross` | EMA(12) is above EMA(26) | n/a |
| `macd_cross` | MACD histogram is positive | n/a |

A triggered alert is suppressed for 5 minutes. Details, defaults and caveats are
in [docs/alerts.md](docs/alerts.md).

## How the pipeline works

```
external cron  ──POST──▶  /api/cron/evaluate-alerts
                              │
    ①  POST /api/data/collect-prices      watchlists → symbols → Delta candles
                                             → price_history + indicator_data
    ②  POST /api/alerts/evaluate          alerts vs latest data
                                             → alert_logs, last_triggered_at
    ③  POST /api/notifications/send       per triggered alert → channels
```

The orchestrator calls the three stages over HTTP against its own public base
URL, so each stage is independently callable and testable. Collection failures
are reported without aborting evaluation.

Deep dive: [docs/architecture.md](docs/architecture.md).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19, Server Actions) |
| Language | TypeScript 5.7 |
| Database | PostgreSQL via Drizzle ORM |
| Styling | Tailwind CSS 4 + shadcn/ui + `@base-ui/react` |
| Validation | Zod 4 |
| Auth | bcryptjs + HMAC-signed stateless session cookies |
| Exchange | Hand-rolled Delta REST client (`lib/delta-exchange.ts`) |
| AI | Anthropic Messages API |

No chart library, no ORM-generated migrations history, no TA library — each of
those was a deliberate omission rather than an oversight.

## Project layout

```
app/
  page.tsx                     Dashboard (server component, live statistics)
  login/  watchlists/  alerts/  analytics/  settings/
  actions/                     Server Actions: auth, alerts, watchlists,
                               notifications, analytics, api-credentials
  api/
    cron/evaluate-alerts/      Pipeline orchestrator
    data/collect-prices/       Stage 1
    alerts/evaluate/           Stage 2
    notifications/send/        Stage 3
    ai/insights/               Optional Claude commentary
    system/health/             Multi-subsystem health check
components/
  dashboard-header.tsx         Navigation and logout
  ui/button.tsx                shadcn button primitive
lib/
  indicators.ts                RSI / EMA / MACD — the only indicator maths
  delta-exchange.ts            Exchange REST client
  encryption.ts                AES-256-GCM credential encryption
  auth.ts  password.ts         Session lifecycle, bcrypt validation
  session.ts  cookie-signature.ts   Signed cookie session primitives
  api-auth.ts                  Bearer-token guard for /api/*
  schemas.ts                   Zod schemas and the condition catalogue
  db/                          Drizzle schema and client
proxy.ts                       Edge middleware gating UI routes
drizzle/                       Generated SQL migrations
docs/                          Full documentation
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (type errors fail the build) |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run check` | Typecheck and lint together |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:push` | Diff schema against the database and apply |
| `npm run db:generate` | Generate a migration after a schema change |
| `npm run db:studio` | Browse data in a GUI |

CI runs typecheck, lint and build on every push and pull request.

## Documentation

Everything technical lives in [`docs/`](docs/README.md).

| Document | Contents |
|---|---|
| [installation.md](docs/installation.md) | Setup from zero |
| [configuration.md](docs/configuration.md) | Environment variables and tuning |
| [architecture.md](docs/architecture.md) | Pipeline, module map, design decisions |
| [alerts.md](docs/alerts.md) | Condition semantics and cooldown behaviour |
| [notifications.md](docs/notifications.md) | Channel setup per platform |
| [api.md](docs/api.md) | Endpoint reference |
| [database.md](docs/database.md) | Tables, indexes, retention, migrations |
| [deployment.md](docs/deployment.md) | Hosting, scheduling, hardening |
| [health-check.md](docs/health-check.md) | Health endpoint contract |
| [testing.md](docs/testing.md) | Manual end-to-end verification |
| [troubleshooting.md](docs/troubleshooting.md) | Symptom-driven fixes |
| [security.md](docs/security.md) | Threat model and secret handling |

## Security

Set `APP_PASSWORD_HASH` before exposing the app to any network you do not
control — without it the dashboard is open.

- Exchange credentials are encrypted with AES-256-GCM at rest.
- Internal API routes require `Authorization: Bearer $ALERT_API_KEY` and fail
  closed in production.
- `/api/system/health` is intentionally unauthenticated for uptime monitors.
  It exposes no secrets, but it does reveal configuration shape.
- Notification channel credentials (webhook URLs, bot tokens) are stored as
  plaintext JSON — unlike exchange keys.

See [SECURITY.md](SECURITY.md) for reporting a vulnerability and
[docs/security.md](docs/security.md) for the full threat model.

## Limitations

Stated plainly, because they will otherwise surprise you:

- **No automated tests.** There is a thorough manual checklist in
  [docs/testing.md](docs/testing.md) instead.
- **Email notifications are not implemented** — the channel logs and reports
  success.
- **Indicator values are approximate.** RSI uses a simple average rather than
  Wilder's smoothing, EMA is seeded from the first close in the window, and
  every run recomputes over a sliding 50-candle window. Expect different numbers
  from your exchange. Details in
  [docs/alerts.md](docs/alerts.md#indicator-fidelity).
- **`macd_cross` is not a crossover detector** — it tests whether the histogram
  is currently positive.
- **No notification retries.** One attempt per trigger; a channel that is down
  loses that delivery.
- **Single operator.** One shared password, no per-user permissions, no audit
  log of who changed what.
- **No API rate limiting.** Add one at your reverse proxy.
- **Email/webhook secrets are unencrypted at rest.**

## Contributing

Issues and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and how to add a condition
or a notification channel, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).

This project is for monitoring and informational purposes. It places no orders
and is not financial advice. Trading carries substantial risk of loss.