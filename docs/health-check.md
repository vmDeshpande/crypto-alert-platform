# Health check

```
GET  /api/system/health
POST /api/system/health
```

Both methods are supported so monitoring tools can use whichever they prefer.
The route is **intentionally unauthenticated** — see
[security.md](security.md#the-health-endpoint) before exposing it.

## Response

```json
{
  "status": "degraded",
  "timestamp": "2026-10-03T12:30:45.123Z",
  "subsystems": {
    "database": {
      "status": "healthy",
      "message": "Database connection successful",
      "details": {
        "totalConnectionCount": 4,
        "idleConnectionCount": 3,
        "waitingRequestCount": 0,
        "queryTest": "SELECT * FROM api_credentials LIMIT 1"
      },
      "lastCheck": "2026-10-03T12:30:45.101Z"
    }
  },
  "summary": "System operational with 4 degraded subsystem(s) - some features may be limited"
}
```

Every subsystem uses the same shape:

| Field | Type | Notes |
|---|---|---|
| `status` | `healthy` \| `degraded` \| `unhealthy` | |
| `message` | string | Human-readable |
| `details` | object | Type-specific; absent on some failures |
| `lastCheck` | ISO timestamp | |
| `error` | string | Only when the check threw |

## HTTP status

| Overall | HTTP |
|---|---|
| `healthy` | 200 |
| `degraded` | 200 |
| `unhealthy` | 503 |

The route returns `503` only when a **critical** subsystem is `unhealthy` —
currently `database` or `deltaExchange`. Anything else unhealthy still yields
`200` with a `degraded` overall status, because alerts can often still be
evaluated. Treat `503` as "page someone", `degraded` as "check the details".

## Subsystems

All six run in parallel via `Promise.all`, so a slow dependency delays only its
own result.

### `database` — critical

Executes a real query and reports `pg` pool statistics.

- `healthy` — query succeeded
- `unhealthy` — `DATABASE_URL` wrong, database down, pool exhausted, or the
  schema is missing (the query fails)

### `deltaExchange` — critical

Decrypts the first active credential and calls `getTicker` on the first watchlist
symbol.

- `healthy` — API responded; `details` includes `credentialName`, `testSymbol`,
  `lastPrice`, `bid`, `ask`, `volume24h`
- `degraded` — no active credentials, or no watchlist symbols
- `unhealthy` — decryption failed (wrong `ENCRYPTION_KEY`), credentials invalid,
  or the API is unreachable

### `priceCollection`

Reports how fresh `price_history` is.

- `healthy` — newest candle under 24 hours old
- `degraded` — no data at all, or older than `STALE_PRICE_HOURS` (24)
- `unhealthy` — query failed

`details` includes `totalDataPoints`, `uniqueSymbols`, `priceAgeHours` and the
last price.

### `indicators`

Recomputes indicators from stored candles as a smoke test.

- `healthy` — indicator rows exist and at least 15 candles are available
- `degraded` — no indicator rows yet, or fewer than 15 candles
- `unhealthy` — query or calculation failed

`details.testCalculations` shows RSI, EMA12, EMA26 and the MACD histogram
recomputed at check time.

### `alertEvaluation`

Reports whether the pipeline can actually do anything.

- `healthy` — active alerts exist **and** price and indicator data are present
- `degraded` — no alerts, or the data they need is missing
- `unhealthy` — query failed

`details` breaks this into `totalAlerts`, `activeAlerts`,
`priceDataAvailable`, `indicatorDataAvailable` and `canEvaluate`.

### `discord`

Probes configured Discord channels with a read-only `GET` — no message is sent.

- `healthy` — a webhook responded `2xx`
- `degraded` — no Discord channels configured, all inactive, or none reachable
- `unhealthy` — never returned; a thrown error degrades rather than fails

Only Discord is probed. Telegram and webhook channels are not checked.

## Expected state on a fresh install

`degraded` is the correct starting point, not a fault:

| Subsystem | Status | Why |
|---|---|---|
| `database` | healthy | Works immediately |
| `deltaExchange` | degraded | No credentials yet |
| `priceCollection` | degraded | No watchlist or no data |
| `indicators` | degraded | Fewer than 15 candles |
| `alertEvaluation` | degraded | No alerts yet |
| `discord` | degraded | No webhook yet |

To reach `healthy`, work through [installation.md](installation.md#5-first-time-setup-in-the-ui)
in order, then let one cron cycle run.

## Usage

```bash
# Overall status
curl -s http://localhost:3000/api/system/health | jq -r '.status'

# Just the database
curl -s http://localhost:3000/api/system/health | jq '.subsystems.database'

# Which subsystems are unhappy
curl -s http://localhost:3000/api/system/health \
  | jq '.subsystems | to_entries | map(select(.value.status != "healthy")) | map({(.key): .value.message})'
```

### Uptime monitoring

Point any HTTP monitor at the URL and expect `200`. Because `degraded` still
returns `200`, a monitor on status code alone will not notice missing
credentials. Watch the body instead:

```
Expected body: "status":"healthy"
```

Or alert on the summary line with a threshold that tolerates partial setup.

### Gate the cron on health

```bash
if [ "$(curl -s http://localhost:3000/api/system/health | jq -r '.status')" = "healthy" ]; then
  curl -X POST http://localhost:3000/api/cron/evaluate-alerts \
    -H "Authorization: Bearer $ALERT_API_KEY" -d '{}'
fi
```

Be aware this suppresses alerts during partial setups, when `priceCollection` is
legitimately `degraded` on a new symbol.

## Cost and caching

Typically 200–500 ms, dominated by the exchange ticker call. Safe to poll every
30 seconds. Results are not cached — status changes quickly.

`indicatorData` is queried with `LIMIT 10` and `priceHistory` with `LIMIT 50`,
so the load is bounded regardless of table size.

## Security

The response contains no secrets: credential rows are counted and decrypted only
in memory, never serialised, and indicator test values are derived from public
candle data.

It does reveal **configuration shape** — whether credentials, watchlists,
alerts and a Discord webhook exist, how many symbols are tracked, and current
prices. On a private deployment that is harmless. On a public one, put the route
behind an authenticating proxy or restrict it to your monitoring network.