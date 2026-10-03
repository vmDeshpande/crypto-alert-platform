/**
 * Technical indicator calculations.
 *
 * Single source of truth for RSI, EMA and MACD. These are intentionally simple
 * implementations rather than the textbook variants:
 *
 *   - RSI uses a simple average of the last `period` gains/losses instead of
 *     Wilder's smoothing.
 *   - EMA is seeded with the first price of the window rather than an SMA.
 *   - MACD's signal line is an EMA over the price series with the current MACD
 *     value appended, not an EMA over the full MACD series.
 *
 * That makes results depend on the input window and shift when data is
 * collected at different times. It is fast and dependency-free, which is why it
 * is here; if you need canonical values, replace the bodies below and keep the
 * signatures.
 */

export interface MacdResult {
  macd: number
  signal: number
  histogram: number
}

export interface IndicatorSnapshot {
  rsi: number
  ema12: number
  ema26: number
  macd: MacdResult
}

/** Default lookback windows, matching the values persisted in `indicator_data`. */
export const DEFAULT_RSI_PERIOD = 14
export const FAST_EMA_PERIOD = 12
export const SLOW_EMA_PERIOD = 26
export const SIGNAL_PERIOD = 9

/**
 * Relative Strength Index over the last `period` changes.
 * Returns 0 when there is not enough history, and 100 when there are no losses.
 */
export function calculateRSI(prices: number[], period: number = DEFAULT_RSI_PERIOD): number {
  if (prices.length < period + 1) return 0

  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }

  const recentGains = gains.slice(-period)
  const recentLosses = losses.slice(-period)
  const avgGain = recentGains.reduce((sum, value) => sum + value, 0) / period
  const avgLoss = recentLosses.reduce((sum, value) => sum + value, 0) / period

  if (avgLoss === 0) return avgGain > 0 ? 100 : 0

  return 100 - 100 / (1 + avgGain / avgLoss)
}

/** Exponential moving average across the whole input window. */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0

  const multiplier = 2 / (period + 1)
  let ema = prices[0]

  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier)
  }

  return ema
}

/** MACD line, signal line and histogram. Zeroed until 26 points are available. */
export function calculateMACD(prices: number[]): MacdResult {
  if (prices.length < SLOW_EMA_PERIOD) {
    return { macd: 0, signal: 0, histogram: 0 }
  }

  const macd =
    calculateEMA(prices, FAST_EMA_PERIOD) - calculateEMA(prices, SLOW_EMA_PERIOD)
  const signal = calculateEMA([...prices.slice(0, -FAST_EMA_PERIOD), macd], SIGNAL_PERIOD)

  return { macd, signal, histogram: macd - signal }
}

/** Convenience wrapper returning every indicator computed during price collection. */
export function calculateIndicators(prices: number[]): IndicatorSnapshot {
  return {
    rsi: calculateRSI(prices),
    ema12: calculateEMA(prices, FAST_EMA_PERIOD),
    ema26: calculateEMA(prices, SLOW_EMA_PERIOD),
    macd: calculateMACD(prices),
  }
}