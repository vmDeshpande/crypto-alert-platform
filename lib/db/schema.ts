import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  real,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Encrypted exchange API credentials.
 *
 * Only `delta` is implemented (see `lib/delta-exchange.ts`). The key and
 * secret are AES-256-GCM ciphertext; see `lib/encryption.ts`.
 */
export const apiCredentials = pgTable("api_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  exchange: varchar("exchange", { length: 100 }).notNull().default("delta"),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  encryptedApiSecret: text("encrypted_api_secret").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** A named collection of tracked symbols. Drives which candles get collected. */
export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    symbols: text("symbols").array().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    nameIdx: index("idx_watchlists_name").on(table.name),
  }),
);

/**
 * An alert rule.
 *
 * `conditionValue` is the primary threshold; the optional `secondCondition*`
 * pair is combined with `comparisonOperator`. Only `price_above` and
 * `price_below` are supported as a second condition — see
 * `app/api/alerts/evaluate/route.ts`.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    conditionType: varchar("condition_type", { length: 50 }).notNull(),
    conditionValue: real("condition_value"),
    secondConditionType: varchar("second_condition_type", { length: 50 }),
    secondConditionValue: real("second_condition_value"),
    comparisonOperator: varchar("comparison_operator", { length: 10 }),
    notificationChannels: text("notification_channels").array().notNull().default([]),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    lastTriggeredAt: timestamp("last_triggered_at"),
  },
  (table) => ({
    watchlistIdIdx: index("idx_alerts_watchlist_id").on(table.watchlistId),
    symbolIdx: index("idx_alerts_symbol").on(table.symbol),
    isActiveIdx: index("idx_alerts_is_active").on(table.isActive),
  }),
);

/** OHLCV candles collected from the exchange. */
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: bigint("volume", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    symbolTimestampIdx: uniqueIndex("idx_price_history_symbol_timestamp").on(
      table.symbol,
      table.timestamp,
    ),
  }),
);

/**
 * Computed technical indicators, one row per indicator per candle.
 *
 * `indicatorType` is one of `rsi`, `ema`, `macd`; `metadata` carries the
 * period for EMA and the signal/histogram values for MACD.
 */
export const indicatorData = pgTable(
  "indicator_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    indicatorType: varchar("indicator_type", { length: 50 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    value: real("value").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    symbolTimestampIdx: index("idx_indicator_data_symbol_timestamp").on(
      table.symbol,
      table.timestamp,
    ),
  }),
);

/** One row per alert trigger. */
export const alertLogs = pgTable(
  "alert_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id").notNull(),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    triggeredValue: real("triggered_value").notNull(),
    notificationStatus: varchar("notification_status", { length: 50 }).default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    alertIdIdx: index("idx_alert_logs_alert_id").on(table.alertId),
  }),
);

/**
 * A notification destination.
 *
 * `config` shape depends on `channelType`:
 *   discord  -> { webhookUrl }
 *   telegram -> { botToken, chatId }
 *   email    -> { email }
 *   webhook  -> { url }
 */
export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelType: varchar("channel_type", { length: 50 }).notNull(),
    channelName: varchar("channel_name", { length: 255 }).notNull(),
    config: jsonb("config").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    channelTypeIdx: index("idx_notification_channels_type").on(table.channelType),
  }),
);

/** Delivery attempts for `webhook`-type channels. */
export const webhookLogs = pgTable("webhook_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertId: uuid("alert_id").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  payload: jsonb("payload").notNull(),
  statusCode: bigint("status_code", { mode: "bigint" }),
  response: text("response"),
  createdAt: timestamp("created_at").defaultNow(),
});