# Alerts

## Anatomy of an alert

| Field | Meaning |
|---|---|
| `watchlistId` | Owning watchlist. Informational — collection is driven by the union of all watchlists, not by this link |
| `name` | Label shown in the UI |
| `symbol` | Delta Exchange symbol, e.g. `BTCUSD`. Must also appear in a watchlist or it will never be collected |
| `conditionType` | One of the conditions below |
| `conditionValue` | Primary threshold. Optional for conditions that have a sensible default |
| `secondConditionType` / `secondConditionValue` | Optional second threshold |
| `comparisonOperator` | `AND` or `OR`, used only when a second condition is set |
| `notificationChannels` | Channel IDs to notify. Empty means the alert fires silently |
| `isActive` | Inactive alerts are skipped by the evaluator |
| `lastTriggeredAt` | Set on trigger; drives the 5-minute cooldown |

## Conditions

All evaluation happens in `checkPrimary` in
`app/api/alerts/evaluate/route.ts` against the two most recent closes and the
latest stored indicator values.

| Condition | Fires when | Threshold | Data used |
|---|---|---|---|
| `price_above` | Latest close > threshold | required | Latest close |
| `price_below` | Latest close < threshold | required | Latest close |
| `price_change_percent` | Absolute close-to-close move > threshold | required | Last two closes |
| `volume_spike` | Latest candle volume > threshold % above the 10-candle average | optional, default 50 | Last 10 candles |
| `rsi_overbought` | RSI(14) > threshold | optional, default 70 | `indicator_data` |
| `rsi_oversold` | RSI(14) < threshold | optional, default 30 | `indicator_data` |
| `macd_cross` | MACD histogram > 0 | ignored | `indicator_data` |
| `moving_average_cross` | EMA(12) > EMA(26) | ignored | `indicator_data` |

Two behaviours that surprise people:

- **`price_change_percent` is a candle-to-candle move**, not a change over 24
  hours. Collection uses 1-hour candles, so it is effectively an hourly move.
- **`macd_cross` does not detect a crossover.** It tests whether the histogram
  is currently positive. To be notified on the transition itself you would need
  a previous histogram value, which is not stored per row.

### Second conditions

An alert can carry a second condition combined with `AND` or `OR`. Only
`price_above` and `price_below` are implemented for it — any other type is
treated as unmet. With `OR`, `price_below` alone is enough to fire regardless of
the primary condition.

## Cooldown

A triggered alert is suppressed for 5 minutes (`COOLDOWN_MS`). This prevents an
alert resting above its threshold from notifying on every cron cycle.

The evaluation response reports the suppression explicitly:

```json
{ "alertId": "…", "status": "not_triggered", "reason": "Alert on cooldown" }
```

Toggling an alert off and on does not clear the cooldown — it expires on its
own.

## Indicator fidelity

Indicators are computed in `lib/indicators.ts` with deliberately simplified
formulas:

- **RSI** averages the last 14 gains and losses with a simple mean rather than
  Wilder's smoothing.
- **EMA** is seeded with the first close of the 50-candle window rather than an
  SMA, so it behaves like a smoothed price with no meaningful warm-up.
- **MACD**'s signal line is an EMA over the price series with the current MACD
  value appended, not an EMA over the full MACD series.

Combined with the fact that every collection run recomputes indicators over a
sliding 50-candle window, values will differ from the ones your exchange shows.
`macd_cross` and `moving_average_cross` are effectively "current trend is
up" checks rather than precise signals.

That is a deliberate trade-off — no TA dependency, fully readable, and cheap
enough to recompute on every run. If you need canonical values, replace the
function bodies in `lib/indicators.ts` and keep the signatures; nothing else
depends on the internals.

## Practical guidance

- Symbol casing is normalised to uppercase on creation, but collection matches
  the watchlist entries exactly. Keep them consistent.
- Attach at least one notification channel. An alert with none fires, writes to
  `alert_logs`, and notifies nobody.
- With 1-hour candles, a 5-minute cron finds a new candle about once an hour.
  Everything else in a cycle is a cheap no-op. Running more often than hourly
  adds little; running less often delays alerts by up to the interval.
- Indicators need 15+ candles to be meaningful and 26+ for MACD. A brand-new
  watchlist will report `no_data` or fire nothing for the first runs.
- A trigger writes `alert_logs` with `notification_status = 'pending'`. Nothing
  in the current code updates that column, so treat it as "recorded", not
  "delivered".

## Creating alerts

Through the UI at **Alerts → Create Alert**, or directly:

```bash
curl -X POST http://localhost:3000/api/alerts \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "watchlistId": "00000000-0000-0000-0000-000000000000",
    "name": "BTC drops below 30k",
    "symbol": "BTCUSD",
    "conditionType": "price_below",
    "conditionValue": 30000,
    "notificationChannels": []
  }'
```

The endpoint is a read-only `GET`; creation goes through the server action
behind the UI form.

To find a `watchlistId` and channel IDs:

```sql
SELECT id, name FROM watchlists;
SELECT id, channel_name, channel_type, is_active FROM notification_channels;
```

## Testing a condition without waiting

Force a trigger by setting a threshold the current price will satisfy, then run
the cycle:

```bash
# Latest stored close for a symbol
psql "$DATABASE_URL" -c \
  "SELECT symbol, close, timestamp FROM price_history WHERE symbol='BTCUSD' ORDER BY timestamp DESC LIMIT 1;"

# Create an alert that is certain to fire now, then:
curl -X POST http://localhost:3000/api/alerts/evaluate \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -d '{"symbol":"BTCUSD"}'
```

If you need to re-trigger the same alert within the cooldown window, clear it
manually:

```sql
UPDATE alerts SET last_triggered_at = NULL WHERE id = '…';
```

## Evaluation response

```json
{
  "success": true,
  "evaluated": 3,
  "triggered": 1,
  "alerts": [
    {
      "id": "…",
      "name": "BTC drops below 30k",
      "symbol": "BTCUSD",
      "triggeredValue": 29987.4,
      "condition": "price_below",
      "notificationChannels": ["…"]
    }
  ],
  "details": [
    { "alertId": "…", "status": "triggered", "reason": "Price $29987.40 < $30000" },
    { "alertId": "…", "status": "not_triggered", "reason": "Condition not met" },
    { "alertId": "…", "status": "no_data", "reason": "No price data available" }
  ]
}
```

`status` is one of `triggered`, `not_triggered`, `no_data` or `error`. The
per-alert `details` array is the first place to look when an alert is not
behaving.