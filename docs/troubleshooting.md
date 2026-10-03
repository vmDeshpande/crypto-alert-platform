# Troubleshooting

Start with the health endpoint — it usually localises the problem in one
request:

```bash
curl -s http://localhost:3000/api/system/health | jq '{status, summary, problems: (.subsystems | to_entries | map(select(.value.status != "healthy") | {key, value: .value.message}))}'
```

See [health-check.md](health-check.md) for what each subsystem reports.

---

## The pipeline never runs

**Nothing fires unless something calls `POST /api/cron/evaluate-alerts`.** The
app has no internal scheduler — that is by design. Set up cron: see
[deployment.md](deployment.md#scheduling).

Confirm the schedule actually reaches you:

```bash
psql "$DATABASE_URL" -c "SELECT max(created_at) FROM price_history;"
```

If that timestamp is stale, the scheduler is not calling. Check the cron
provider's own execution log.

### `500` — "Unable to determine base URL"

The cron route calls your own deployment over HTTP and cannot work out the
address. Set `APP_URL` to a URL reachable from inside the deployment:

```env
APP_URL="https://sentinel.example.com"
```

Inside Docker Compose, `localhost` is wrong — the route needs to reach the app
container. Use `http://app:3000` or your reverse proxy's hostname. Outside
`next dev` there is no fallback; see
[configuration.md](configuration.md#app-url).

### `401 Unauthorized` from your cron service

The `Authorization` header does not match `ALERT_API_KEY`. Watch for:

- a trailing space or a newline in the key
- `Bearer` capitalisation
- the header being stripped by a proxy
- the key in the provider's UI differing from your `.env.local`

### Nothing happens even with `200` responses

Check `results.notifications.failed` — alerts may be firing with every channel
broken. Also confirm alerts actually have channels attached:

```sql
SELECT id, name, notification_channels FROM alerts;
```

An empty array means the alert fires silently. That is the most common cause of
"my alert does nothing".

---

## Collection problems

### "No active API credentials configured"

No row in `api_credentials` with `is_active = true`.

```sql
SELECT id, name, exchange, is_active FROM api_credentials;
```

Re-enable or re-add the credential in Settings.

### "No symbols in watchlists"

`watchlists.symbols` is empty across all lists. Collection reads the union of
every watchlist — an alert's `watchlistId` does not cause collection on its own.

### `collected: 0` on every run

Only candles **newer** than the newest stored row are inserted. With 1-hour
candles and a 5-minute schedule, most runs correctly collect nothing. A run
that reports `collected: 1` roughly once an hour is working.

If it is always `0` and the newest candle is already current, there is simply
nothing new.

### `failedSymbols` is populated

The exchange rejected those symbols. Check the format — Delta uses its own
notation, for example `BTCUSD`, not `BTC-USD` or `BTC/USD`.

Verify against the exchange directly:

```bash
curl -s "https://api.delta.exchange/v2/tickers" | jq '.result[] | select(.symbol | test("BTC")) | .symbol'
```

### Decryption errors in the logs

Symptoms: `deltaExchange` reports `unhealthy`, collection logs an
authentication or crypto error, and no candles arrive.

The stored ciphertext cannot be read with the current `ENCRYPTION_KEY`. Either
`ENCRYPTION_KEY` changed, or the credentials were encrypted under a different
key. Re-enter them in Settings.

### Duplicate candles

You are on a version predating the unique index on
`(symbol, timestamp)`. Clean up and re-apply the schema — see
[database.md](database.md#price_history).

---

## Alerts never fire

Walk it in order.

1. **Is the alert active?**
   ```sql
   SELECT id, name, is_active FROM alerts;
   ```

2. **Is the symbol being collected?**
   ```sql
   SELECT DISTINCT symbol FROM price_history;
   ```
   An alert on a symbol absent from every watchlist has no data, ever.

3. **Is there data for that symbol?**
   ```sql
   SELECT symbol, close, timestamp, now() - timestamp AS age
   FROM price_history WHERE symbol = 'BTCUSD'
   ORDER BY timestamp DESC LIMIT 3;
   ```
   A large `age` means collection has stalled.

4. **What does the evaluator say?**
   ```bash
   curl -X POST http://localhost:3000/api/alerts/evaluate \
     -H "Authorization: Bearer $ALERT_API_KEY" \
     -H "Content-Type: application/json" -d '{"symbol":"BTCUSD"}'
   ```
   The `details` array is the diagnostic. `reason` tells you exactly why each
   alert did not fire: `"Alert on cooldown"`, `"Condition not met"`,
   `"No price data available"`, or an `error`.

5. **Is it on cooldown?** Within 5 minutes of the last trigger, every evaluation
   returns `"Alert on cooldown"`. Clear it:
   ```sql
   UPDATE alerts SET last_triggered_at = NULL WHERE id = '…';
   ```

6. **Is the threshold reachable?** Compare against the latest close:
   ```sql
   SELECT close FROM price_history
   WHERE symbol='BTCUSD' ORDER BY timestamp DESC LIMIT 1;
   ```

### Indicator conditions never fire

RSI and MACD need history. RSI needs 15 candles, MACD needs 26. A new watchlist
produces `no_data` or zeroes for the first runs — `calculateMACD` returns
`{0, 0, 0}` below 26 candles, so `macd_cross` evaluates `0 > 0` as false.

```sql
SELECT count(*) FROM price_history WHERE symbol = 'BTCUSD';
```

### Values look wrong compared to the exchange

Expected. The indicator implementations are deliberately simplified and
recomputed over a sliding window. See
[alerts.md](alerts.md#indicator-fidelity).

---

## Notifications not arriving

### `sent: 0`

No channel in the alert's `notification_channels` matched an active channel.

```sql
SELECT id, channel_name, channel_type, is_active FROM notification_channels;
SELECT name, notification_channels FROM alerts;
```

Channel IDs must match exactly, and the channel must be active.

### `failed: 1`

Check the `error` field in the response, then the platform:

- **Discord** — `404` means the webhook was deleted; re-create it. Verify
  without posting: `curl -o /dev/null -w '%{http_code}' <webhook-url>`
- **Telegram** — `401` means a bad bot token. `400` with "chat not found" means
  the bot cannot reach that chat: start the bot first, then message it so
  `getUpdates` reports a chat ID, and for groups make sure it can post.
- **Webhook** — check your own logs. Non-`2xx` responses are recorded in
  `webhook_logs` with the response body.

### Nothing is delivered but `failed: 0`

Two possibilities:

- The channel type is `email`, which logs instead of sending and reports
  success. Not implemented.
- An inactive channel was skipped. `channelIds` entries that do not match an
  active channel are dropped silently.

### Repeated notifications for one alert

The cooldown should prevent this. If it is not working, check
`alerts.last_triggered_at` is being written:

```sql
SELECT id, name, last_triggered_at FROM alerts ORDER BY last_triggered_at DESC;
```

If it is `NULL` on a triggered alert, the evaluator may be erroring partway —
look for `status: "error"` in the evaluation response.

---

## Database problems

### `relation "alerts" does not exist`

Schema not applied.

```bash
npm run db:migrate
```

### `ENCRYPTION_KEY environment variable is required in production`

`NODE_ENV=production` with no `ENCRYPTION_KEY`. Set it and restart.

### `too many connections`

Each process opens its own `pg` pool, and serverless multiplies processes. Use
your provider's pooled connection string, or put PgBouncer in front.

### Health check shows a healthy database but queries time out

Pool exhaustion — requests are queued behind `waitingCount`. Check
`subsystems.database.details` for `waitingRequestCount`. Reduce concurrency or
raise the pool size.

---

## Authentication problems

### The dashboard is open even though I set a password

`proxy.ts` reads `APP_PASSWORD_HASH`. Verify the variable is present in the
runtime environment and restart — Next.js only reads env at startup.

```bash
grep APP_PASSWORD_HASH .env.local   # confirm it is uncommented
```

### I cannot log in

The hash must be bcrypt at cost 10. Generate it with:

```bash
node -e "require('bcryptjs').hash('your-password', 10).then(h => console.log(h))"
```

If the input file is `bcryptjs` v3 this works; if you upgraded and have v2, use
`bcryptjs.hash` with a callback instead. Confirm the hash is in `$2b$` form and
is the whole value with no trailing comment — an inline `# note` after the hash
is a common mistake and makes the comparison fail.

### Logged out on every request

The cookie is not persisting. Almost always HTTPS:

- `secure: true` is set when `NODE_ENV=production`, so plain HTTP never stores
  the cookie. Use HTTPS, or run in development mode locally.
- Confirm the browser is not blocking the cookie for another reason.

### Every session is invalid

`SESSION_SECRET` or `ENCRYPTION_KEY` changed, or the app is running on multiple
instances with different values. Sessions are signed, so a key mismatch across
instances invalidates cookies.

---

## Build and tooling problems

### `next build` fails on TypeScript

The project no longer ignores build errors, so type errors fail the build
deliberately.

```bash
npm run typecheck
```

### `npm run lint` reports `react-hooks/set-state-in-effect`

That rule is disabled in `eslint.config.mjs`. If you see it, you are running a
different config or an older checkout.

### `Cannot find module '@/lib/...'`

The `@/*` alias is defined in `tsconfig.json` and resolves to the repo root.
Check `tsconfig.json` was not reformatted.

### Port already in use

```bash
npm run dev -- --port 3001
```

Then update `APP_URL` and any cron configuration to match.

---

## Getting more detail

Server logs are prefixed `[crypto-sentinel]`. In development:

```bash
npm run dev 2>&1 | tee sentinel.log
grep '\[crypto-sentinel\]' sentinel.log
```

Useful queries:

```sql
-- Current pipeline state
SELECT symbol, count(*) AS candles, max(timestamp) AS newest,
       now() - max(timestamp) AS age
FROM price_history GROUP BY symbol;

-- Recent triggers
SELECT a.name, l.symbol, l.triggered_value, l.created_at
FROM alert_logs l LEFT JOIN alerts a ON a.id = l.alert_id
ORDER BY l.created_at DESC LIMIT 20;

-- Alerts that never fired
SELECT id, name, symbol, created_at FROM alerts
WHERE id NOT IN (SELECT DISTINCT alert_id FROM alert_logs);

-- Webhook deliveries
SELECT created_at, status_code, left(response, 200) AS response
FROM webhook_logs ORDER BY created_at DESC LIMIT 20;
```

If you are opening an issue, include the health response and the relevant
`[crypto-sentinel]` log lines.