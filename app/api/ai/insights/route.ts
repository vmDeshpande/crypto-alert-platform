import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const MODEL = 'claude-3-5-sonnet-20241022'
const MAX_TOKENS = 300

type InsightType = 'price_analysis' | 'alert_summary' | 'market_insight'

interface InsightRequest {
  symbol: string
  priceData?: {
    current: number
    high: number
    low: number
    change: number
    volume: number
  }
  alertData?: {
    name: string
    condition: string
    value: number
    recentTriggers: number
  }
  type: InsightType
}

/**
 * Generates short natural-language market commentary with the Anthropic API.
 * Requires `ANTHROPIC_API_KEY`.
 */
export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request)
  if (denied) return denied

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI insights are disabled — set ANTHROPIC_API_KEY' },
      { status: 503 },
    )
  }

  const body: InsightRequest = await request.json().catch(() => null)
  if (!body?.symbol || !body.type) {
    return NextResponse.json(
      { error: 'Missing required fields: symbol, type' },
      { status: 400 },
    )
  }

  try {
    const insight = await generateInsight(apiKey, body)
    return NextResponse.json({
      success: true,
      symbol: body.symbol,
      type: body.type,
      insight,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[crypto-sentinel] AI insight generation failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate insight', message: String(error) },
      { status: 502 },
    )
  }
}

export async function GET(request: NextRequest) {
  const denied = rejectUnauthorized(request)
  if (denied) return denied

  return NextResponse.json({
    status: process.env.ANTHROPIC_API_KEY ? 'operational' : 'disabled',
    service: 'AI Insights',
    supportedTypes: ['price_analysis', 'alert_summary', 'market_insight'],
  })
}

function buildPrompt(request: InsightRequest): string {
  const { symbol, priceData, alertData, type } = request

  switch (type) {
    case 'price_analysis':
      return [
        `Analyze this cryptocurrency price data and provide a brief insight:`,
        `Symbol: ${symbol}`,
        `Current Price: $${priceData?.current}`,
        `24h High: $${priceData?.high}`,
        `24h Low: $${priceData?.low}`,
        `24h Change: ${priceData?.change}%`,
        `Volume: ${priceData?.volume}`,
        ``,
        `Provide 2-3 key insights about the current price action in a concise paragraph.`,
      ].join('\n')

    case 'alert_summary':
      return [
        `Provide a brief analysis of this alert's performance:`,
        `Alert: ${alertData?.name}`,
        `Condition: ${alertData?.condition}`,
        `Threshold: ${alertData?.value}`,
        `Recent Triggers (24h): ${alertData?.recentTriggers}`,
        ``,
        `Is this alert performing well? Any recommendations? Keep response to 2-3 sentences.`,
      ].join('\n')

    case 'market_insight':
      return [
        `Generate a brief market insight for ${symbol}:`,
        `Current Price: $${priceData?.current}`,
        `24h Range: $${priceData?.low} - $${priceData?.high}`,
        `24h Volume: $${priceData?.volume}`,
        ``,
        `What factors might be influencing ${symbol} right now? 1-2 sentences.`,
      ].join('\n')
  }
}

async function generateInsight(apiKey: string, request: InsightRequest): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(request) }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as { content: { text: string }[] }
  return data.content[0]?.text ?? ''
}