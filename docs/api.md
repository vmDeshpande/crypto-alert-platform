# API reference

All routes are `force-dynamic` and live under `app/api/`.

## Authentication

Two schemes, depending on the path.

| Path | Scheme |
|---|---|
| `/api/system/health` | None — public by design |
| Every other `/api/*` route | `Authorization: Bearer $ALERT_API_KEY` |

The bearer check lives in `lib/api-auth.ts` and uses a constant-time
comparison. It is skipped in development when `ALERT_API_KEY` is unset, and
**fails closed in production** — an unset key rejects every request.

The dashboard UI is not part of this API. It calls server actions in
`app/actions/` using the session cookie instead.

## Summary

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/cron/evaluate-alerts` | Full pipeline: collect → evaluate → notify |
| `POST` | `/api/data/collect-prices` | Stage 1 — candles and indicators |
| `POST` | `/api/alerts/evaluate` | Stage 2 — condition evaluation |
| `POST` | `/api/notifications/send` | Stage 3 — channel dispatch |
| `GET` | `/api/alerts` | List alerts |
| `GET` `POST` | `/api/ai/insights` | Claude commentary (optional) |
| `GET` `POST` | `/api/system/health` | Subsystem health |

Mutating routes return `405` with `{ "error": "… only" }` for `GET`.

---

## `POST /api/cron/evaluate-alerts`

Runs the whole pipeline. This is the endpoint your scheduler calls.

Resolves the deployment's own base URL from `APP_URL`,
`VERCEL_PROJECT_PRODUCTION_URL` or `VERCEL_URL`, then calls the three stages
over HTTP. Returns `500` if no base URL can be determined.

**Request body** — ignored; pass `{}`.

**Response**

```json
{
  "success": true,
  "message": "Evaluated 3 alerts, triggered 1, sent 2 notifications",
  "results": {
    "priceCollection": {
      "success": true,
      "collected": 2,
      "symbols": ["BTCUSD", "ETHUSD"],
      "failed": 0,
      "failedSymbols": []
    },
    "alertEvaluation": {
      "success": true,
      "evaluated": 3,
      "triggered": 1,
      "alerts": [ /* see /api/alerts/evaluate */ ],
      "details": []
    },
    "notifications": { "sent": 2, "failed": 0 },
    "timestamp": "2026-10-03T12:35:00.000Z"
  }
}
```

Collection failures are captured in `results.priceCollection` without aborting
the cycle. Evaluation failure returns `500`.

```bash
curl -X POST http://localhost:3000/api/cron/evaluate-alerts \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

---

## `POST /api/data/collect-prices`

Stage 1. Collects candles and recomputes indicators.

Takes the union of symbols across every watchlist, decrypts the first active
credential, and fetches 50 one-hour candles per symbol. Inserts only candles
newer than what is stored, then writes four `indicator_data` rows per symbol
(`rsi`, `ema` period 12, `ema` period 26, `macd`). Prunes candles older than 365
days.

**Response**

```json
{
  "success": true,
  "collected": 2,
  "symbols": ["BTCUSD", "ETHUSD"],
  "failed": 1,
  "failedSymbols": [{ "symbol": "BADSYM", "error": "Ticker not found for BADSYM" }]
}
```

Early exits return `200` with a message instead:

```json
{ "success": true, "collected": 0, "message": "No active API credentials configured" }
{ "success": true, "collected": 0, "message": "No symbols in watchlists" }
```

One bad symbol does not stop the others; each failure is listed in
`failedSymbols`.

```bash
curl -X POST http://localhost:3000/api/data/collect-prices \
  -H "Authorization: Bearer $ALERT_API_KEY"
```

---

## `POST /api/alerts/evaluate`

Stage 2. Evaluates active alerts against stored data. Does not fetch anything
from the exchange — run `collect-prices` first.

**Request body** (all fields optional)

```json
{ "alertIds": ["uuid"], "symbol": "BTCUSD" }
```

Without either, every active alert is evaluated.

**Response**

```json
{
  "success": true,
  "evaluated": 3,
  "triggered": 1,
  "alerts": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "BTC drops below 30k",
      "symbol": "BTCUSD",
      "triggeredValue": 29987.4,
      "condition": "price_below",
      "notificationChannels": ["channel-uuid"]
    }
  ],
  "details": [
    { "alertId": "…", "status": "triggered", "reason": "Price $29987.40 < $30000", "triggeredValue": 29987.4 },
    { "alertId": "…", "status": "not_triggered", "reason": "Condition not met" },
    { "alertId": "…", "status": "not_triggered", "reason": "Alert on cooldown" },
    { "alertId": "…", "status": "no_data", "reason": "No price data available" },
    { "alertId": "…", "status": "error", "reason": "…" }
  ]
}
```

Side effects per trigger: one `alert_logs` row and `alerts.last_triggered_at`
set to now, which starts the 5-minute cooldown. See
[alerts.md](alerts.md) for condition semantics.

```bash
curl -X POST http://localhost:3000/api/alerts/evaluate \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD"}'
```

---

## `POST /api/notifications/send`

Stage 3. Normally called by the orchestrator, but callable directly to test a
channel.

**Request body**

```json
{
  "alertId": "550e8400-e29b-41d4-a716-446655440000",
  "alertName": "BTC drops below 30k",
  "symbol": "BTCUSD",
  "triggeredValue": 29987.4,
  "channelIds": ["channel-uuid-1", "channel-uuid-2"]
}
```

**Response**

```json
{
  "success": true,
  "alertId": "550e8400-…",
  "sent": 1,
  "failed": 1,
  "notifications": {
    "sent": [{ "channelId": "channel-uuid-1", "channelType": "discord" }],
    "failed": [{ "channelId": "channel-uuid-2", "channelType": "telegram", "error": "HTTP 401" }]
  }
}
```

Only active channels are considered, and only those whose ID appears in
`channelIds`. Unknown IDs are skipped silently. `webhook` channels additionally
write a `webhook_logs` row. See [notifications.md](notifications.md).

```bash
curl -X POST http://localhost:3000/api/notifications/send \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"alertId":"…","alertName":"Test","symbol":"BTCUSD","triggeredValue":29987.4,"channelIds":["…"]}'
```

---

## `GET /api/alerts`

Returns every alert row, newest first.

```bash
curl -H "Authorization: Bearer $ALERT_API_KEY" http://localhost:3000/api/alerts
```

Creation and editing go through server actions, not this route. For scripted
setup, insert rows directly or use the UI.

---

## `GET|POST /api/ai/insights`

Optional Claude commentary. Requires `ANTHROPIC_API_KEY`; without it `POST`
returns `503`.

**Request body**

```json
{
  "symbol": "BTCUSD",
  "type": "price_analysis",
  "priceData": { "current": 42350.5, "high": 43000, "low": 41800, "change": 1.8, "volume": 15230.4 },
  "alertData": { "name": "BTC drops below 30k", "condition": "price_below", "value": 30000, "recentTriggers": 2 }
}
```

`type` is `price_analysis`, `alert_summary` or `market_insight`. `priceData` is
required for the two price types, `alertData` for `alert_summary`.

**Response**

```json
{
  "success": true,
  "symbol": "BTCUSD",
  "type": "price_analysis",
  "insight": "…",
  "timestamp": "2026-10-03T12:36:00.000Z"
}
```

`GET` reports `operational` or `disabled` and the supported types.

---

## `GET|POST /api/system/health`

Public. Runs six subsystem checks in parallel and returns `200` for
`healthy`/`degraded`, `503` for `unhealthy`. Full contract in
[health-check.md](health-check.md).

---

## Errors

| Status | Body | Cause |
|---|---|---|
| `401` | `{ "error": "Unauthorized" }` | Missing or wrong bearer token |
| `404` | Next.js default | Unknown path |
| `405` | `{ "error": "POST only" }` | Wrong method on a mutating route |
| `500` | varies | Unhandled failure; the body carries the cause for the cron, collect, evaluate and notify routes |
| `502` | `{ "error": "Failed to generate insight", "message": … }` | Anthropic API failure |
| `503` | `{ "error": "AI insights are disabled — set ANTHROPIC_API_KEY" }` | Missing key |

Collection failures are the deliberate exception: they return `200` with a
per-symbol `failedSymbols` list, because one bad symbol should not abort the
cycle.

## Rate limiting

There is none. On a public deployment, rate-limit at your proxy or CDN. The
pipeline's own volume is one request per stage per cron cycle.