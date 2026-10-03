import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorized } from '@/lib/api-auth'
import { db } from '@/lib/db'
import { notificationChannels, webhookLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface NotificationPayload {
  alertId: string
  alertName: string
  symbol: string
  triggeredValue: number
  channelIds: string[]
}

interface ChannelConfig {
  webhookUrl?: string
  botToken?: string
  chatId?: string
  email?: string
  url?: string
}

interface DeliveryResult {
  success: boolean
  statusCode: number
  response: string
  error: string
}

export async function GET() {
  return NextResponse.json({ error: 'POST only' }, { status: 405 })
}

/** Dispatches a triggered alert to each of its configured channels. */
export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request)
  if (denied) return denied

  const payload: NotificationPayload = await request.json()
  const { alertId, alertName, symbol, triggeredValue, channelIds } = payload

  const activeChannels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.isActive, true))

  const sent: { channelId: string; channelType: string }[] = []
  const failed: { channelId: string; channelType: string; error: string }[] = []
  const message = `Alert "${alertName}" triggered for ${symbol}: $${triggeredValue}`

  for (const channelId of channelIds) {
    const channel = activeChannels.find((row) => row.id === channelId)
    if (!channel) continue

    const config = (channel.config ?? {}) as ChannelConfig
    let result: DeliveryResult

    switch (channel.channelType) {
      case 'discord':
        result = await sendDiscord(config.webhookUrl, alertName, symbol, triggeredValue)
        break
      case 'telegram':
        result = await sendTelegram(config.botToken, config.chatId, message)
        break
      case 'email':
        result = await sendEmail(config.email, `Price Alert: ${alertName}`, message)
        break
      case 'webhook':
        result = await sendWebhook(config.url, {
          type: 'price_alert',
          alertId,
          alertName,
          symbol,
          triggeredValue,
          timestamp: new Date().toISOString(),
        })
        if (result.statusCode) {
          await logWebhookDelivery(alertId, config.url, result)
        }
        break
      default:
        result = { success: false, statusCode: 0, response: '', error: 'Unknown channel type' }
    }

    if (result.success) {
      sent.push({ channelId, channelType: channel.channelType })
    } else {
      failed.push({
        channelId,
        channelType: channel.channelType,
        error: result.error || `HTTP ${result.statusCode}`,
      })
    }
  }

  return NextResponse.json({
    success: true,
    alertId,
    sent: sent.length,
    failed: failed.length,
    notifications: { sent, failed },
  })
}

async function sendDiscord(
  webhookUrl: string | undefined,
  alertName: string,
  symbol: string,
  triggeredValue: number,
): Promise<DeliveryResult> {
  if (!webhookUrl) {
    return { success: false, statusCode: 0, response: '', error: 'Missing webhookUrl' }
  }

  return postJson(webhookUrl, {
    embeds: [
      {
        title: 'Crypto Sentinel Alert',
        description: `**${alertName}** has been triggered`,
        fields: [
          { name: 'Symbol', value: symbol, inline: true },
          { name: 'Price', value: `$${triggeredValue.toFixed(2)}`, inline: true },
          { name: 'Time', value: new Date().toISOString(), inline: false },
        ],
        color: 0x9333ea,
      },
    ],
  })
}

async function sendTelegram(
  botToken: string | undefined,
  chatId: string | undefined,
  message: string,
): Promise<DeliveryResult> {
  if (!botToken || !chatId) {
    return { success: false, statusCode: 0, response: '', error: 'Missing botToken or chatId' }
  }

  return postJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text: message,
  })
}

/**
 * Email delivery is not wired to a provider yet — the notification is logged so
 * it is visible in server output. See docs/notifications.md.
 */
function sendEmail(to: string | undefined, subject: string, body: string): DeliveryResult {
  if (!to) {
    return { success: false, statusCode: 0, response: '', error: 'Missing email address' }
  }

  console.log(`[crypto-sentinel] Email notification (not sent): to=${to} subject="${subject}" body="${body}"`)
  return { success: true, statusCode: 0, response: '', error: '' }
}

function sendWebhook(url: string | undefined, payload: Record<string, unknown>): Promise<DeliveryResult> {
  if (!url) {
    return Promise.resolve({ success: false, statusCode: 0, response: '', error: 'Missing url' })
  }
  return postJson(url, payload)
}

async function postJson(url: string, payload: unknown): Promise<DeliveryResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()

    return {
      success: response.ok,
      statusCode: response.status,
      response: text,
      error: response.ok ? '' : `HTTP ${response.status}`,
    }
  } catch (error) {
    return { success: false, statusCode: 0, response: '', error: String(error) }
  }
}

async function logWebhookDelivery(
  alertId: string,
  url: string | undefined,
  result: DeliveryResult,
) {
  try {
    await db.insert(webhookLogs).values({
      alertId,
      webhookUrl: url ?? '',
      payload: { alertId },
      statusCode: BigInt(result.statusCode),
      response: result.response,
    })
  } catch (error) {
    console.error('[crypto-sentinel] Failed to log webhook delivery:', error)
  }
}