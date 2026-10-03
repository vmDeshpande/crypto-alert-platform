# Contributing

Thanks for your interest. This project is a self-hosted tool, and contributions
that make it easier to run, understand and trust are the most useful.

## Getting set up

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL, ALERT_API_KEY, ENCRYPTION_KEY
npm run db:push                # create the tables
npm run dev
```

You do not need real exchange credentials to work on the UI — most pages render
fine with an empty database. See [docs/installation.md](docs/installation.md).

## Before opening a pull request

```bash
npm run check     # typecheck + lint
npm run build
```

CI runs the same three commands. A change that needs a suppression comment is a
signal to reconsider the approach.

## Guidelines

- **Keep the pipeline honest.** The three stages in
  `app/api/cron/`, `app/api/data/` and `app/api/alerts/evaluate/` are the core
  of the product. Changes there need a corresponding update to
  [docs/architecture.md](docs/architecture.md) and
  [docs/testing.md](docs/testing.md).
- **One source of truth for calculations.** Technical indicators live in
  `lib/indicators.ts`. If you add an indicator, put the maths there and consume
  it everywhere rather than copying it into a route.
- **Never log or commit secrets.** Ciphertext may be stored; plaintext API keys
  must not appear in code, logs, fixtures or documentation.
- **Document user-visible changes** in the relevant file under `docs/`.
- **Prefer small PRs** with a clear description of the behaviour change.

## Adding a notification channel

1. Extend the `channelType` enum in `lib/schemas.ts`.
2. Add a sender in `app/api/notifications/send/route.ts` returning
   `DeliveryResult`.
3. Add the matching config keys to the `notification_channels` table comment in
   `lib/db/schema.ts`.
4. Add a tab to `app/settings/notifications/page.tsx`.
5. Document it in [docs/notifications.md](docs/notifications.md).

## Adding an alert condition

1. Add the value to `CONDITION_TYPES` and `CONDITION_LABELS` in
   `lib/schemas.ts`.
2. Add a case to `checkPrimary` in `app/api/alerts/evaluate/route.ts`.
3. If it needs historical price data rather than the latest close, make sure the
   collection window covers it.
4. Document the semantics and defaults in [docs/alerts.md](docs/alerts.md).

## Reporting bugs

Open an issue with what you expected, what happened, and the relevant log lines
(server logs are prefixed `[crypto-sentinel]`). If it involves the database,
include the output of `GET /api/system/health`.

## Code of Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your work is licensed under the
[MIT License](LICENSE).