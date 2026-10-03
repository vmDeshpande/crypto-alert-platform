# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[security advisory](https://github.com/vmDeshpande/crypto-alert-platform/security/advisories/new)
form rather than opening a public issue. Include a description, reproduction
steps, and the impact you observed.

We aim to acknowledge reports within a few days.

## Threat model

Crypto Sentinel is designed for **single-operator, self-hosted** use. It is not
multi-tenant: there is one dashboard password and one set of exchange
credentials. Anyone who can reach the dashboard can read every watchlist, alert
and trigger history.

## What the project does and does not protect

| Area | Status |
|---|---|
| Exchange API keys at rest | Encrypted with AES-256-GCM (`ENCRYPTION_KEY`) |
| Dashboard access | Optional bcrypt password; signed `httpOnly` session cookie |
| Internal API | `ALERT_API_KEY` bearer token, constant-time compared |
| Transport | Expected to run behind TLS; terminate it at your proxy or platform |
| `/api/system/health` | **Intentionally unauthenticated** so uptime monitors can read it. It returns configuration shape and counts, never secrets |
| Multi-user isolation | **Not implemented.** Do not expose it as a shared service |

## Deploying safely

1. Set `APP_PASSWORD_HASH` before exposing the app to any network you do not
   control. Without it the dashboard is open.
2. Set `SESSION_SECRET` (or `ENCRYPTION_KEY`, which is reused as a fallback) so
   session cookies are signed with a secret only you know. Production startup
   refuses to sign without one.
3. Keep `ALERT_API_KEY` long and random. It is the only thing standing between
   the public internet and your alert pipeline.
4. Keep `.env.local` out of version control. `.env` is gitignored; verify your
   hosting provider's ignore rules match.
5. Prefer HTTPS. Session cookies set `secure` in production, so a plaintext
   deployment will not persist logins.
6. Rotate `ENCRYPTION_KEY` only together with re-entering your exchange
   credentials — existing ciphertext becomes unreadable.
7. Restrict database access by network if your provider allows it, and use the
   pooled connection string for the app.

## Known gaps

- The health endpoint reveals whether credentials, watchlists and alerts exist.
  Put it behind a private network or an authenticating proxy if that matters to
  you.
- There is no rate limiting on the API routes. Put a rate limiter in your proxy
  or CDN in front of a public deployment.
- There are no automated tests covering the authentication paths.
- Email notifications are not implemented, so no email credentials are stored.

See [docs/security.md](docs/security.md) for the full threat model and
[docs/deployment.md](docs/deployment.md) for hardening guidance.