# Installation

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20.11 or newer | `node --version` |
| PostgreSQL | 12 or newer | Local Docker container, Neon, Supabase, RDS — anything reachable |
| npm | 10 or newer | The lockfile is `package-lock.json` |
| Delta Exchange account | — | Only needed for live price data |

You do **not** need exchange credentials to install or to explore the UI.

## 1. Install

```bash
git clone https://github.com/vmDeshpande/crypto-sentinel.git
cd crypto-sentinel
npm install
```

## 2. Configure the environment

```bash
cp .env.example .env.local
```

Fill in at minimum:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/crypto_sentinel"
ALERT_API_KEY="<32 random bytes as hex>"
ENCRYPTION_KEY="<32 random bytes as hex>"
```

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optionally add a dashboard password and a public URL:

```bash
node -e "require('bcryptjs').hash('your-password', 10).then(h => console.log(h))"
```

See [configuration.md](configuration.md) for the full variable reference.

## 3. Create the database

Point `DATABASE_URL` at your database, then apply the schema. Either:

```bash
# Apply the committed migrations (recommended)
npm run db:migrate
```

or, during experimentation, let Drizzle diff the schema against the database:

```bash
npm run db:push
```

The generated SQL is committed at
[`drizzle/0000_init.sql`](../drizzle/0000_init.sql) if you prefer to apply it
yourself:

```bash
psql "$DATABASE_URL" -f drizzle/0000_init.sql
```

## 4. Run it

```bash
npm run dev
```

Open <http://localhost:3000>.

## 5. First-time setup in the UI

The pipeline needs four things configured before anything can fire. Do them in
this order:

1. **Settings → API credentials** — add your Delta Exchange API key and secret.
   They are encrypted with AES-256-GCM before being stored. Without this,
   collection returns "No active API credentials configured".
2. **Watchlists** — create a list and add symbols. Use Delta's own symbol
   format, for example `BTCUSD`. This list is the only input to price
   collection.
3. **Settings → Notifications** — register at least one channel. A Discord
   webhook is the quickest to verify.
4. **Alerts → Create Alert** — pick a watchlist, symbol, condition and the
   channels to notify.

## 6. Verify the pipeline manually

Do not wait for a scheduler. Trigger a full cycle yourself:

```bash
curl -X POST http://localhost:3000/api/cron/evaluate-alerts \
  -H "Authorization: Bearer $ALERT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Outside `next dev` the cron route needs to know its own public URL. Set
`APP_URL` when self-hosting; Vercel injects its own variables. See
[deployment.md](deployment.md).

Check that the first response reports `"collected": 1` or more. Then confirm
system state:

```bash
curl -s http://localhost:3000/api/system/health | jq '.status, .summary'
```

Follow the guided walkthrough in [testing.md](testing.md) to verify each stage
individually.

## Running with Docker

The repository does not ship a Dockerfile — the app is a standard Next.js
server, so any Node base image works.

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```

Compose a Postgres service alongside it and pass the environment through. Full
walkthrough in [deployment.md](deployment.md#docker).

## Troubleshooting the install

| Symptom | Cause | Fix |
|---|---|---|
| `relation "alerts" does not exist` | Schema not applied | `npm run db:migrate` |
| `ENCRYPTION_KEY environment variable is required in production` | Missing secret with `NODE_ENV=production` | Set `ENCRYPTION_KEY` in `.env.local` |
| `Unable to determine base URL` from the cron route | No public URL configured | Set `APP_URL` |
| `No active API credentials configured` | No credentials stored | Add them in Settings |
| `No symbols in watchlists` | Collection has no input | Add symbols to a watchlist |
| Port 3000 in use | Another process | `npm run dev -- --port 3001` and update `APP_URL` |

More in [troubleshooting.md](troubleshooting.md).

## Next steps

- [deployment.md](deployment.md) — schedule the pipeline and harden the deployment
- [alerts.md](alerts.md) — what each condition actually measures
- [security.md](security.md) — set `APP_PASSWORD_HASH` before exposing the app