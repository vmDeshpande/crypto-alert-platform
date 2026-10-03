import { z } from 'zod'

/**
 * Every alert condition the evaluator understands.
 * Keep in sync with `checkPrimary` in `app/api/alerts/evaluate/route.ts` and the
 * condition picker in `app/alerts/new/page.tsx`.
 */
export const CONDITION_TYPES = [
  'price_above',
  'price_below',
  'price_change_percent',
  'volume_spike',
  'rsi_overbought',
  'rsi_oversold',
  'moving_average_cross',
  'macd_cross',
] as const

export type ConditionType = (typeof CONDITION_TYPES)[number]

/** Human-readable labels for the condition picker. */
export const CONDITION_LABELS: Record<ConditionType, string> = {
  price_above: 'Price above',
  price_below: 'Price below',
  price_change_percent: 'Price change % (absolute)',
  volume_spike: 'Volume spike %',
  rsi_overbought: 'RSI overbought',
  rsi_oversold: 'RSI oversold',
  moving_average_cross: 'EMA cross (12 above 26)',
  macd_cross: 'MACD histogram positive',
}

/** Conditions whose `conditionValue` is optional — sensible defaults are applied. */
export const CONDITIONS_WITH_DEFAULT = new Set<ConditionType>([
  'rsi_overbought',
  'rsi_oversold',
  'volume_spike',
])

// Authentication
export const loginSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

export type LoginInput = z.infer<typeof loginSchema>

// API Credentials
export const apiCredentialsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  apiKey: z.string().min(1, 'API Key is required'),
  apiSecret: z.string().min(1, 'API Secret is required'),
})

export type ApiCredentialsInput = z.infer<typeof apiCredentialsSchema>

// Watchlist
export const watchlistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  symbols: z.array(z.string().min(1)).default([]),
})

export type WatchlistInput = z.infer<typeof watchlistSchema>

// Alert
export const alertSchema = z.object({
  watchlistId: z.string().uuid('Invalid watchlist ID'),
  name: z.string().min(1, 'Alert name is required').max(255),
  symbol: z.string().min(1, 'Symbol is required').max(50),
  conditionType: z.enum(CONDITION_TYPES),
  conditionValue: z.number().optional(),
  secondConditionType: z.enum(CONDITION_TYPES).optional(),
  secondConditionValue: z.number().optional(),
  comparisonOperator: z.enum(['AND', 'OR']).optional(),
  notificationChannels: z.array(z.string()).default([]),
})

export type AlertInput = z.infer<typeof alertSchema>

// Notification Channel
export const notificationChannelSchema = z.object({
  channelType: z.enum(['discord', 'telegram', 'email', 'webhook']),
  channelName: z.string().min(1, 'Channel name is required').max(255),
  config: z.record(z.string(), z.any()),
})

export type NotificationChannelInput = z.infer<typeof notificationChannelSchema>