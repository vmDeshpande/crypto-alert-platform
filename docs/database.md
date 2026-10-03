# Database

PostgreSQL via Drizzle ORM. `lib/db/schema.ts` is the single source of truth;
`drizzle/0000_init.sql` is the generated SQL for the current schema.

## Applying the schema

```bash
# Apply committed migrations
npm run db:migrate

# Or diff the schema against the database and apply the difference
npm run db:push

# Or apply the SQL directly
psql "$DATABASE_URL" -f drizzle/0000_init.sql
```

`db:push` is convenient while iterating and destructive-by-design when it
detects renames or drops. Prefer `db:migrate` once you have data you care about.

After changing `lib/db/schema.ts`:

```bash
npm run db:generate   # writes a new migration to drizzle/
npm run db:migrate    # applies it
```

`npm run db:studio` opens a GUI for browsing data.

## Tables

### `api_credentials`

Encrypted exchange credentials. Only `delta` is implemented.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `varchar(255)` | Label |
| `exchange` | `varchar(100)` | Defaults to `delta` |
| `encrypted_api_key` | `text` | AES-256-GCM ciphertext |
| `encrypted_api_secret` | `text` | AES-256-GCM ciphertext |
| `is_active` | `boolean` | Collection uses the first active row |
| `created_at`, `updated_at` | `timestamp` | |

Ciphertext layout is `iv || authTag || ciphertext`, all hex — see
`lib/encryption.ts`. Never read these columns into a response; the server
action returns metadata only.

### `watchlists`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `varchar(255)` | Indexed |
| `description` | `text` | Optional |
| `symbols` | `text[]` | Union across all lists drives collection |
| `created_at`, `updated_at` | `timestamp` | |

### `alerts`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `watchlist_id` | `uuid` | Indexed |
| `name` | `varchar(255)` | |
| `symbol` | `varchar(50)` | Indexed |
| `condition_type` | `varchar(50)` | See [alerts.md](alerts.md) |
| `condition_value` | `real` | Nullable; defaults applied in code |
| `second_condition_type` / `second_condition_value` | `varchar(50)` / `real` | Nullable |
| `comparison_operator` | `varchar(10)` | `AND` or `OR` |
| `notification_channels` | `text[]` | Channel IDs |
| `is_active` | `boolean` | Indexed |
| `last_triggered_at` | `timestamp` | Drives the 5-minute cooldown |

Indexed on `watchlist_id`, `symbol` and `is_active` — the three columns the
evaluator filters on. There is no foreign key to `watchlists`; deleting a
watchlist leaves its alerts behind, and there is no cascade.

### `price_history`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `symbol` | `varchar(50)` | |
| `timestamp` | `timestamp` | Candle open time |
| `open`, `high`, `low`, `close` | `real` | |
| `volume` | `bigint` | |
| `created_at` | `timestamp` | |

**Unique index on `(symbol, timestamp)`.** Collection also inserts only candles
newer than the newest stored row, so the constraint should never fire. If you
are upgrading from a version without the unique index and have duplicates, clean
them before applying:

```sql
DELETE FROM price_history a
USING price_history b
WHERE a.id > b.id
  AND a.symbol = b.symbol
  AND a.timestamp = b.timestamp;
```

### `indicator_data`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `symbol` | `varchar(50)` | |
| `indicator_type` | `varchar(50)` | `rsi`, `ema` or `macd` |
| `timestamp` | `timestamp` | Candle the value belongs to |
| `value` | `real` | RSI, the EMA, or the MACD line |
| `metadata` | `jsonb` | EMA: `{ period }`. MACD: `{ signal, histogram }` |

Indexed on `(symbol, timestamp)`. The evaluator reads the newest rows for a
symbol and picks out `rsi`, `ema` with `metadata.period` 12 and 26, and `macd`.
`macd_histogram` comes from `metadata.histogram`.

### `alert_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `alert_id` | `uuid` | Indexed. No FK |
| `symbol` | `varchar(50)` | |
| `triggered_value` | `real` | Close at trigger time |
| `notification_status` | `varchar(50)` | Defaults to `pending` |
| `created_at` | `timestamp` | |

One row per trigger. `notification_status` is never updated by the current
code — treat it as "recorded", not "delivered".

### `notification_channels`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `channel_type` | `varchar(50)` | Indexed. `discord`, `telegram`, `email`, `webhook` |
| `channel_name` | `varchar(255)` | |
| `config` | `jsonb` | Keys depend on the type |
| `is_active` | `boolean` | Inactive channels are skipped |
| `created_at`, `updated_at` | `timestamp` | |

`config` shapes:

```json
{"type": "discord",  "webhookUrl": "https://discord.com/api/webhooks/…"}
{"type": "telegram", "botToken": "…", "chatId": "…"}
{"type": "email",    "email": "you@example.com"}
{"type": "webhook",  "url": "https://example.com/hook"}
```

Stored as plaintext JSON — see the note in
[notifications.md](notifications.md#secret-handling).

### `webhook_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `alert_id` | `uuid` | |
| `webhook_url` | `text` | |
| `payload` | `jsonb` | Alert ID only |
| `status_code` | `bigint` | |
| `response` | `text` | Raw response body, may be large |
| `created_at` | `timestamp` | |

Written only for `webhook` channels.

## Retention

`collect-prices` deletes candles older than 365 days on every run
(`RETENTION_DAYS`). Nothing prunes `indicator_data`, `alert_logs` or
`webhook_logs` — those grow without bound. On a busy install, prune them
yourself:

```sql
DELETE FROM indicator_data WHERE created_at < now() - interval '90 days';
DELETE FROM alert_logs    WHERE created_at < now() - interval '1 year';
DELETE FROM webhook_logs  WHERE created_at < now() - interval '30 days';
```

Estimate storage: one candle row is roughly 100 bytes. At one hourly candle per
symbol, 10 symbols for a year is about 876 KB — negligible. Indicator rows
outnumber candle rows 4:1 and are not pruned by default, so prune them if you
track many symbols.

## Connection handling

`lib/db/index.ts` creates one `pg` `Pool` per process using `DATABASE_URL`.

- **Serverless:** use your provider's pooled connection string. Each warm
  instance holds its own pool, and serverless scales instances.
- **Long-running server:** the pool is bounded by `pg` defaults. If you expect
  heavy concurrency, set `PGPOOL_MAX` in the connection string.
- **Many replicas:** each replica gets its own pool. Keep the total under your
  database's connection limit or put PgBouncer in front.

## Useful queries

```sql
-- Latest price per symbol
SELECT DISTINCT ON (symbol) symbol, close, timestamp
FROM price_history ORDER BY symbol, timestamp DESC;

-- How stale is our data?
SELECT symbol, max(timestamp) AS newest, now() - max(timestamp) AS age
FROM price_history GROUP BY symbol ORDER BY age DESC;

-- Trigger history
SELECT a.name, l.symbol, l.triggered_value, l.created_at
FROM alert_logs l LEFT JOIN alerts a ON a.id = l.alert_id
ORDER BY l.created_at DESC LIMIT 50;

-- Alerts that have never fired
SELECT id, name, symbol, created_at FROM alerts
WHERE id NOT IN (SELECT DISTINCT alert_id FROM alert_logs);

-- Channel inventory
SELECT channel_type, count(*), count(*) FILTER (WHERE is_active) AS active
FROM notification_channels GROUP BY channel_type;
```

## Backup

The database holds your watchlists, alerts, notification channels and
encrypted exchange credentials. Market data (`price_history`,
`indicator_data`) rebuilds itself from the exchange within a day.

A minimal backup is everything except those two tables:

```bash
pg_dump "$DATABASE_URL" \
  --exclude-table=price_history \
  --exclude-table=indicator_data \
  --exclude-table=alert_logs \
  --exclude-table=webhook_logs \
  > sentinel-config-$(date +%F).sql
```

Restoring a backup preserves the encrypted credentials **only if you also
restore the matching `ENCRYPTION_KEY`.** Without it, `api_credentials` rows
cannot be decrypted and must be re-entered.