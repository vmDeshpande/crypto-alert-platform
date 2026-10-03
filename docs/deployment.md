# Deployment

Crypto Sentinel is a stateless Next.js server plus a PostgreSQL database. It has
no background workers, so the only runtime requirement is something that
periodically calls `POST /api/cron/evaluate-alerts`.

## Pre-flight

- [ ] `DATABASE_URL` points at a reachable database, using the **pooled** string
      on serverless platforms
- [ ] `ENCRYPTION_KEY` is set to 32 random bytes as hex
- [ ] `ALERT_API_KEY` is set to 32 random bytes as hex, and differs from any
      development value
- [ ] `APP_PASSWORD_HASH` is set — otherwise the dashboard is public
- [ ] `APP_URL` is set (or a Vercel URL variable exists)
- [ ] The schema is applied (`npm run db:migrate`)
- [ ] The app is served over HTTPS

## Environment summary

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled connection string |
| `ALERT_API_KEY` | Yes | Bearer token for `/api/*` |
| `ENCRYPTION_KEY` | Yes | 64-char hex; credential encryption |
| `APP_PASSWORD_HASH` | Strongly recommended | Omit only on a trusted network |
| `APP_URL` | Yes, unless on Vercel | Cron route's self-call target |
| `SESSION_SECRET` | Optional | Falls back to `ENCRYPTION_KEY` |
| `ANTHROPIC_API_KEY` | No | Enables `/api/ai/insights` |

Full reference in [configuration.md](configuration.md).

---

## Vercel

1. Import the repository.
2. Add the environment variables above. `VERCEL_PROJECT_PRODUCTION_URL` is
   injected automatically, so `APP_URL` is optional.
3. Add `vercel.json` to schedule the pipeline:

```json
{
  "crons": [
    { "path": "/api/cron/evaluate-alerts", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel sends `GET` for cron paths. The route only implements `POST`, so add a
thin GET handler or switch to a middleware that upgrades the method. Verify this
against current Vercel cron behaviour before relying on it.

4. Deploy, then open `/login` and confirm the password gate works.

Note that the serverless execution limit applies to the whole cycle. Keep the
symbol count modest or split the stages across separate invocations.

---

## Docker

### Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: crypto_sentinel
    volumes:
      - db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sentinel"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://sentinel:${DB_PASSWORD}@postgres:5432/crypto_sentinel
      ALERT_API_KEY: ${ALERT_API_KEY}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      APP_PASSWORD_HASH: ${APP_PASSWORD_HASH:-}
      APP_URL: ${APP_URL}
    ports:
      - "3000:3000"

volumes:
  db:
```

The `Dockerfile` is in [installation.md](installation.md#running-with-docker).

```bash
docker compose up -d --build
docker compose exec app npx drizzle-kit migrate
docker compose exec postgres \
  psql -U sentinel -d crypto_sentinel -f /path/to/drizzle/0000_init.sql
```

> Inside a Compose network, `APP_URL` cannot be `localhost` — the cron route
> calls itself over HTTP. Use a resolvable hostname such as
> `http://app:3000`, or expose the app through a reverse proxy and use its
> public address.

---

## Self-hosted Node

```bash
git clone https://github.com/<owner>/crypto-sentinel.git
cd crypto-sentinel
npm ci
npm run build

export APP_URL="https://sentinel.example.com"
# plus DATABASE_URL, ALERT_API_KEY, ENCRYPTION_KEY, APP_PASSWORD_HASH
export NODE_ENV=production

npm run db:migrate
npm start
```

### systemd

```ini
[Unit]
Description=Crypto Sentinel
After=network-online.target

[Service]
Type=simple
User=sentinel
WorkingDirectory=/opt/crypto-sentinel
EnvironmentFile=/etc/crypto-sentinel.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Reverse proxy

Terminate TLS at nginx or Caddy. The session cookie sets `Secure` in
production, so plain HTTP will not persist logins.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
```

A generous `proxy_read_timeout` matters — the cron route performs the whole
cycle within one request.

---

## Scheduling

**Nothing fires until something calls the cron endpoint.**

### crontab

```cron
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_ALERT_API_KEY" \
  -H "Content-Type: application/json" -d '{}' \
  https://sentinel.example.com/api/cron/evaluate-alerts >> /var/log/sentinel-cron.log 2>&1
```

Guard it so overlapping runs cannot stack:

```cron
*/5 * * * * flock -n /tmp/sentinel-cron.lock curl -fsS -X POST \
  -H "Authorization: Bearer YOUR_ALERT_API_KEY" -d '{}' \
  https://sentinel.example.com/api/cron/evaluate-alerts
```

### Managed cron services

| Service | Interval | Notes |
|---|---|---|
| EasyCron | Every 5 min | Free tier is fine; add the bearer header |
| cron-job.org | Every 5 min | Custom headers supported |
| AWS EventBridge → Lambda | `rate(5 minutes)` | Best for AWS-hosted installs |
| Google Cloud Scheduler | `*/5 * * * *` | Best for GCP-hosted installs |
| GitHub Actions | `*/5 * * * *` | Works, but scheduled workflows can be delayed and are not designed for minute-level polling |

Any of these is acceptable. Pick one and verify a run actually landed:

```bash
psql "$DATABASE_URL" -c \
  "SELECT max(created_at) FROM alert_logs;"
```

### Choosing an interval

Candles are one hour, so a new candle appears roughly hourly:

- **5 minutes** — recommended. Most runs find nothing new and cost one cheap
  query per symbol. Alert delay is at most 5 minutes.
- **1 hour** — cheaper, but alerts can lag an hour behind the candle that
  triggered them.
- **Below 1 minute** — wasteful. Nothing new to evaluate.

---

## Hardening

1. **Require authentication.** Without `APP_PASSWORD_HASH` the dashboard is
   open to anyone who finds the URL.
2. **Set `APP_URL` and verify self-reachability.** If the deployment cannot call
   itself, the pipeline cannot run.
3. **Rotate the keys in `.env` before first push to a public repository.** Any
   value that ever lived in a committed `.env` must be considered exposed.
4. **Use a pooled `DATABASE_URL`.** Serverless platforms otherwise exhaust
   connections quickly.
5. **Put a rate limiter in front of `/api/*`.** There is none built in.
6. **Restrict `/api/system/health`** to your monitoring network if the
   deployment is public — it reveals configuration shape.
7. **Back up the database.** Restoring needs the original `ENCRYPTION_KEY` or
   stored credentials become unreadable. See
   [database.md](database.md#backup).
8. **Monitor it.** Alert on `/api/system/health` returning `503`, and on
   `priceCollection.ageHours` exceeding 24.
9. **Keep dependencies current.** `npm outdated && npm update`.

## Operational checklist

Once deployed, confirm:

```bash
# Health
curl -s "$APP_URL/api/system/health" | jq '{status, summary}'

# A cycle runs and collects
curl -s -X POST "$APP_URL/api/cron/evaluate-alerts" \
  -H "Authorization: Bearer $ALERT_API_KEY" -d '{}' | jq '.results.notifications'

# Data is fresh
psql "$DATABASE_URL" -c \
  "SELECT symbol, max(timestamp), now() - max(timestamp) AS age
   FROM price_history GROUP BY symbol;"
```

Watch these numbers:

| Metric | Healthy |
|---|---|
| `results.priceCollection.collected` | 1 when a new candle appears, 0 otherwise |
| `results.notifications.failed` | 0 |
| `subsystems.priceCollection.priceAgeHours` | Under 24 |
| Time between `alert_logs` rows | Matches your alert expectations |

## Upgrading

```bash
git pull
npm ci
npm run build
npm run db:migrate
sudo systemctl restart crypto-sentinel
```

`ENCRYPTION_KEY` must survive the upgrade unchanged. Check `drizzle/` for new
migrations before restarting.