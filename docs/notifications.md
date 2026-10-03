# Notifications

Channels are configured under **Settings → Notifications** and stored in
`notification_channels`. Each channel is referenced by ID from an alert's
`notification_channels` array.

Delivery happens in `app/api/notifications/send/route.ts`. The cron
orchestrator calls it once per triggered alert with the channel IDs attached to
that alert.

## Channel types

| Type | `config` keys | Status | Delivery |
|---|---|---|---|
| `discord` | `webhookUrl` | Working | POST with a rich embed |
| `telegram` | `botToken`, `chatId` | Working | Bot API `sendMessage` |
| `webhook` | `url` | Working | POST of a `price_alert` payload, logged to `webhook_logs` |
| `email` | `email` | **Stub** | Logs to server output; no provider is wired up |

## Discord

1. Server Settings → Integrations → Webhooks → New Webhook
2. Copy the webhook URL
3. Settings → Notifications → Discord tab, name it, paste the URL

Payload:

```json
{
  "embeds": [
    {
      "title": "Crypto Sentinel Alert",
      "description": "**BTC drops below 30k** has been triggered",
      "fields": [
        { "name": "Symbol", "value": "BTCUSD", "inline": true },
        { "name": "Price", "value": "$29987.40", "inline": true },
        { "name": "Time", "value": "2026-10-03T12:34:56.000Z", "inline": false }
      ],
      "color": 9699114
    }
  ]
}
```

Verify a webhook without sending a message — this is what the health check does:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://discord.com/api/webhooks/<id>/<token>
```

`200` means it is reachable and valid. Delete the channel in Discord to revoke
it; there is no revocation path inside the app.

## Telegram

1. Message `@BotFather` → `/newbot` → copy the token
2. Send your bot any message, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id`
3. Settings → Notifications → Telegram tab, enter token and chat ID

The bot must be able to message the target chat. For groups, add it to the group
and promote it enough to post, or it will fail silently from Telegram's side.

## Webhook

Any endpoint accepting `POST` with JSON. This is the escape hatch for anything
without a native channel — push to a chat service, a home-automation hub, or
your own handler.

```json
{
  "type": "price_alert",
  "alertId": "550e8400-e29b-41d4-a716-446655440000",
  "alertName": "BTC drops below 30k",
  "symbol": "BTCUSD",
  "triggeredValue": 29987.4,
  "timestamp": "2026-10-03T12:34:56.000Z"
}
```

Only `webhook` channels are logged, into `webhook_logs` with the URL, status code
and response body:

```sql
SELECT created_at, webhook_url, status_code, left(response, 200)
FROM webhook_logs
ORDER BY created_at DESC
LIMIT 20;
```

## Email

Not implemented. Selecting `email` produces a server log line and is reported as
a successful delivery, so an alert with only an email channel will look healthy
while nothing is sent.

To implement it, replace `sendEmail` in
`app/api/notifications/send/route.ts` with a provider call (Resend, Postmark,
SendGrid) and add the API key to `.env.example` and
[configuration.md](configuration.md). The `email` config key is already
persisted for you.

## Multiple channels

An alert can attach several channels; all of them are notified on each trigger
and failures are independent. One dead channel does not stop the others — the
response reports them separately:

```json
{
  "success": true,
  "alertId": "…",
  "sent": 1,
  "failed": 1,
  "notifications": {
    "sent": [{ "channelId": "…", "channelType": "discord" }],
    "failed": [{ "channelId": "…", "channelType": "telegram", "error": "HTTP 401" }]
  }
}
```

The cron response aggregates these into `results.notifications.sent` and
`results.notifications.failed`. **Watch the failure count** — a channel silently
failing is the most common reason people think alerts stopped working.

## Channel lifecycle

Channels can be deactivated instead of deleted. An inactive channel is skipped
by the sender but stays referenced by existing alerts, so re-enabling restores
delivery without editing every alert. Deleting removes it, leaving dangling IDs
in `alerts.notification_channels` that are silently ignored at send time.

## Delivery guarantees

There are none beyond one attempt. No retries, no backoff, no queue, no
deduplication beyond the 5-minute alert cooldown. If the receiver is down at
trigger time, that notification is lost — `webhook_logs` is the only record, and
only for `webhook` channels.

For anything that must not be dropped, point a `webhook` channel at a durable
queue of your own and handle retries downstream.

## Secret handling

Bot tokens, webhook URLs and addresses are stored in `notification_channels.config`
as plain JSON — unlike exchange credentials, they are **not** encrypted. Anyone
with database read access, or with the `webhook_logs` payload, can read them.

That is acceptable for a single-operator deployment where the database is
already the trust boundary, but it is a deliberate asymmetry: exchange keys get
AES-256-GCM, notification secrets do not. If you need both encrypted, extend
`lib/encryption.ts` usage to this table.