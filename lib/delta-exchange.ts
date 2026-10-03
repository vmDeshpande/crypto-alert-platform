import crypto from "crypto";

const BASE_URL = "https://api.delta.exchange/v2";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
}

/**
 * Minimal Delta Exchange REST client.
 *
 * Public market data endpoints work without credentials. Private endpoints
 * (balance, positions) require HMAC-SHA256 signed requests — the signing helper
 * is kept here so those can be added without reworking the transport.
 */
export class DeltaExchangeClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  /** Signs `${timestamp}${method}${endpoint}${params}${nonce}` with HMAC-SHA256. */
  private signRequest(
    method: string,
    endpoint: string,
    params?: Record<string, unknown>,
  ): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString("hex");

    let message = `${timestamp}${method}${endpoint}`;
    if (params) message += JSON.stringify(params);
    message += nonce;

    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(message)
      .digest("hex");
  }

  private async request<T>(
    method: string,
    endpoint: string,
    params?: Record<string, unknown>,
    authenticated = false,
  ): Promise<T> {
    const query =
      params && method === "GET"
        ? `?${new URLSearchParams(params as Record<string, string>).toString()}`
        : "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authenticated) {
      headers["api-key"] = this.apiKey;
      headers["signature"] = this.signRequest(method, endpoint, params);
      headers["timestamp"] = Math.floor(Date.now() / 1000).toString();
      headers["nonce"] = crypto.randomBytes(16).toString("hex");
    }

    const response = await fetch(`${BASE_URL}${endpoint}${query}`, {
      method,
      headers,
      body: params && method !== "GET" ? JSON.stringify(params) : undefined,
    });

    if (!response.ok) {
      throw new Error(
        `Delta Exchange API error: ${response.status} - ${await response.text()}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * OHLCV candles for a symbol.
   * @param interval seconds between candles — 60, 300, 900, 3600 or 86400
   * @param limit    number of candles to request (max 500)
   * @returns candles ordered oldest-first
   */
  async getCandles(
    symbol: string,
    interval: number = 3600,
    limit: number = 50,
  ): Promise<Candle[]> {
    const resolutions: Record<number, string> = {
      60: "1m",
      300: "5m",
      900: "15m",
      3600: "1h",
      86400: "1d",
    };
    const resolution = resolutions[interval] ?? "1h";

    const end = Math.floor(Date.now() / 1000);
    const start = end - interval * limit;

    try {
      const response = await this.request<{ success: boolean; result: unknown[] }>(
        "GET",
        "/history/candles",
        { symbol, resolution, start, end },
      );

      if (!response.success || !Array.isArray(response.result)) return [];

      return response.result
        .map((row) => row as Record<string, string | number>)
        .map((row) => ({
          timestamp: Number(row.time) * 1000,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume),
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.error(`[crypto-sentinel] Failed to fetch candles for ${symbol}:`, error);
      throw error;
    }
  }

  /** Latest ticker snapshot for a symbol. */
  async getTicker(symbol: string): Promise<Ticker> {
    try {
      const response = await this.request<{ result?: Record<string, unknown>[] }>(
        "GET",
        "/tickers",
      );

      const ticker = response.result?.find((row) => row.symbol === symbol);
      if (!ticker) throw new Error(`Ticker not found for ${symbol}`);

      return {
        symbol: String(ticker.symbol),
        lastPrice: Number(ticker.close),
        bid: Number(ticker.bid),
        ask: Number(ticker.ask),
        volume24h: Number(ticker.volume),
        change24h: Number(ticker.mark_change_24h),
        changePercent24h: Number(ticker.mark_change_percent_24h),
      };
    } catch (error) {
      console.error(`[crypto-sentinel] Failed to fetch ticker for ${symbol}:`, error);
      throw error;
    }
  }
}

export function createDeltaClient(
  apiKey: string,
  apiSecret: string,
): DeltaExchangeClient {
  return new DeltaExchangeClient(apiKey, apiSecret);
}