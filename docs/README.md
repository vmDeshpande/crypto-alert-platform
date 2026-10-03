# Documentation

Reference material for Crypto Sentinel. The root [README](../README.md) is the
entry point; start there if you are new.

## Start here

| Document | Read it when |
|---|---|
| [installation.md](installation.md) | Setting up a local or fresh deployment |
| [configuration.md](configuration.md) | Deciding what goes in the environment |
| [architecture.md](architecture.md) | Understanding how the pipeline fits together |
| [alerts.md](alerts.md) | Creating alerts and interpreting condition semantics |
| [notifications.md](notifications.md) | Wiring up Discord, Telegram or webhooks |
| [deployment.md](deployment.md) | Putting it online and scheduling the pipeline |
| [troubleshooting.md](troubleshooting.md) | Something is not firing |

## Reference

| Document | Contents |
|---|---|
| [api.md](api.md) | Every HTTP endpoint, request and response shape |
| [database.md](database.md) | Tables, indexes, retention and migrations |
| [health-check.md](health-check.md) | `/api/system/health` contract and subsystems |
| [security.md](security.md) | Threat model, secret handling, hardening |

## Development

| Document | Contents |
|---|---|
| [testing.md](testing.md) | Manual end-to-end pipeline test and checklist |

## Repository conventions

Governance files live at the repository root so GitHub picks them up:

- [CONTRIBUTING.md](../CONTRIBUTING.md) — development workflow and how to add
  conditions or channels
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- [SECURITY.md](../SECURITY.md) — reporting a vulnerability
- [LICENSE](../LICENSE)