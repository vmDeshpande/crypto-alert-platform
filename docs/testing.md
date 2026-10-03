# Testing

There is no automated test suite. This document covers the manual verification
path, which exercises the whole pipeline end to end.

Before running any of it you need: the app running, the schema applied, an
`ALERT_API_KEY`, a Delta Exchange credential, one watchlist with at least one
symbol, and one notification channel. See
[installation.md](installation.md).

Set a shell variable to save typing:

```bash
export ALERT_API_KEY="<your key>"
export BASE="http://localhost:3000"
```

---

## Stage 0 — Baseline health

```bash
curl -s "$BASE/api/system/health" | jq '{status, summary}'
```

Expect `degraded` with the database healthy. Everything else depends on which
setup steps you have completed. See
[health-check.md](health-check.md#expected-state-on-a-fresh-install).

---

## Stage 1 — Price collection

```bash
curl -X POST "$BASE/api/data/collect-prices" \
  -H "Authorization: Bearer $ALERT_API_KEY"
```

**Pass:** `collected` ≥ 1, `failed: 0`, and your symbols listed.

Confirm the rows landed:

```sql
SELECT symbol, close, timestamp FROM price_history
ORDER BY timestamp DESC LIMIT 5;
```

Indicators are written at the same time:

```sql
SELECT symbol, indicator_type, value, metadata FROM indicator_data
ORDER BY created_at DESC LIMIT 8;
```

Expect four rows per symbol: `rsi`, two `ema` entries, `macd`.

**Fail:** `"No active API credentials configured"` → add credentials in
Settings. `"No symbols in watchlists"` → add symbols. `failedSymbols` populated →
the symbol format is wrong; check it against Delta's own symbol list.

Run it twice: the second run should report `collected: 0`, because collection
only inserts candles newer than the newest stored row. That is the incremental
behaviour working, not a bug.

---

## Stage 2 — Alert evaluation

Create an alert that will certainly fire against the current price:

```bash
CLOSE=$(psql "$DATABASE_URL" -tA \
  -c "SELECT close FROM price_history WHERE symbol='BTCUSD' ORDER BY timestamp DESC LIMIT 1")
```

```sql
-- Or just set a threshold far below the market
INSERT INTO alerts (watchlist_id, name, symbol, condition_type, condition_value, notification_channels, is_active)
SELECT id, 'TEST always fires', 'BTCUSD', 'price_above', 0, '{}', true
FROM watchlists LIMIT 1;
```

```bash
curl -X POST "$BASE/api/alerts/evaluate" \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD"}'
```

**Pass:** `triggered: 1`, and `details[0].reason` explains the trigger.

```json
{ "alertId": "…", "status": "triggered", "reason": "Price $42350.50 > $0", "triggeredValue": 42350.5 }
```

The trigger was logged:

```sql
SELECT symbol, triggered_value, notification_status FROM alert_logs
ORDER BY created_at DESC LIMIT 5;
```

### Cooldown check

Run the exact same command again.

**Pass:** `triggered: 0` and `reason: "Alert on cooldown"`.

To reset for further testing:

```sql
UPDATE alerts SET last_triggered_at = NULL WHERE name = 'TEST always fires';
```

### No-data path

```bash
curl -X POST "$BASE/api/alerts/evaluate" \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"NOSUCHSYM"}'
```

**Pass:** `evaluated: 0`. An alert on a symbol with no history returns
`status: "no_data"` rather than failing.

---

## Stage 3 — Notification dispatch

Get a channel ID:

```sql
SELECT id, channel_name, channel_type, is_active FROM notification_channels;
```

```bash
curl -X POST "$BASE/api/notifications/send" \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"alertId\": \"00000000-0000-0000-0000-000000000000\",
    \"alertName\": \"Test notification\",
    \"symbol\": \"BTCUSD\",
    \"triggeredValue\": 42350.5,
    \"channelIds\": [\"<channel id>\"]
  }"
```

**Pass:** `sent: 1, failed: 0`, **and** the message actually arrives.

For a `webhook` channel, confirm the record:

```sql
SELECT created_at, webhook_url, status_code FROM webhook_logs
ORDER BY created_at DESC LIMIT 5;
```

Test each failure mode:

| Test | Expectation |
|---|---|
| Empty `channelIds` | `sent: 0, failed: 0` |
| Unknown channel ID | Skipped silently, no error |
| Inactive channel | Skipped — set `is_active = false` and retry |
| Bad Discord URL | `failed: 1` with `error: "HTTP …"` |

Remember `email` channels log instead of sending, and still report success.

---

## Stage 4 — Full pipeline

```bash
curl -X POST "$BASE/api/cron/evaluate-alerts" \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

**Pass:** `success: true`, and all three stages present in `results`.

Check for partial failure — the field most often ignored:

```bash
... | jq '.results.notifications'
```

```json
{ "sent": 1, "failed": 2 }
```

means alerts fired but most channels are broken.

**Fail:** `500` with `"Unable to determine base URL"` → set `APP_URL`. See
[configuration.md](configuration.md#app-url).

---

## Stage 5 — Authentication

### Bearer token

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/alerts/evaluate"
```

**Pass:** `401`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/alerts/evaluate" \
  -H "Authorization: Bearer wrong-key"
```

**Pass:** `401`.

### Dashboard password

Only enforced when `APP_PASSWORD_HASH` is set.

1. Set the hash, restart the dev server.
2. Visit `/watchlists` → expect a redirect to `/login`.
3. Submit the wrong password → expect an error and no session.
4. Submit the correct password → expect the page.
5. Reload → still signed in.
6. Log out via the header → redirected to `/login`.
7. Inspect the cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production.

Tamper with the cookie value and reload.

**Pass:** redirected to `/login`. A forged or tampered cookie must not be
accepted.

### Health endpoint stays public

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/system/health"
```

**Pass:** `200` with no token. This is deliberate.

---

## Regression checklist

Run after any change to the pipeline, indicators, auth or schema.

**Collection**

- [ ] Collects candles for every watchlist symbol
- [ ] Second run inserts nothing (`collected: 0`)
- [ ] Candles are stored oldest-first
- [ ] Four indicator rows per symbol, correct `metadata`
- [ ] One bad symbol appears in `failedSymbols` without aborting the rest
- [ ] Retention deletes candles older than 365 days

**Evaluation**

- [ ] Each of the eight conditions fires when it should
- [ ] `price_change_percent` compares the last two closes
- [ ] Cooldown suppresses a repeat within 5 minutes
- [ ] `AND` requires both conditions; `OR` requires either
- [ ] Trigger writes `alert_logs` and sets `last_triggered_at`
- [ ] Alerts on a symbol with no data return `no_data`

**Notification**

- [ ] Discord, Telegram and webhook each deliver
- [ ] Multiple channels all receive the same trigger
- [ ] One failing channel does not block the others
- [ ] Inactive channels are skipped
- [ ] `webhook_logs` records status code and response

**Pipeline**

- [ ] Full cycle completes with `success: true`
- [ ] Missing base URL returns a clear 500
- [ ] Stage 1 failure does not prevent stage 2

**Security**

- [ ] `/api/*` returns `401` without a valid bearer token
- [ ] `/api/system/health` stays reachable without one
- [ ] Credential listings never contain ciphertext or plaintext keys
- [ ] No secret appears in server logs
- [ ] Session cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production
- [ ] Forged session cookies are rejected

**Data integrity**

- [ ] Re-running collection does not duplicate candles
- [ ] The `(symbol, timestamp)` unique index is present
- [ ] `/api/alerts` returns rows, not a wrapped object

---

## Performance sanity check

Rough figures on a small install over a normal connection:

| Operation | Typical |
|---|---|
| Collect, 10 symbols | 2–5 s (dominated by exchange round trips) |
| Evaluate, 10 alerts | < 1 s |
| Deliver one Discord message | 200–500 ms |
| Full cycle, 10 symbols / 5 alerts | 8–15 s |
| Health check | 200–500 ms |

Expect the cycle to approach platform function timeouts as symbol count grows.
Past roughly 50 symbols, consider splitting collection from evaluation across
scheduled invocations, or moving to a dedicated worker.

## What is not covered

- No unit tests for `lib/indicators.ts`. If you change the formulas, compare
  against a reference implementation before trusting the output.
- No tests for concurrency, since the pipeline has no shared mutable state.
- No load testing.
- No browser/E2E tests for the UI.

Contributions that add any of these are welcome — see
[CONTRIBUTING.md](../CONTRIBUTING.md).