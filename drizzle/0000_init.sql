CREATE TABLE "alert_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"triggered_value" real NOT NULL,
	"notification_status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"condition_type" varchar(50) NOT NULL,
	"condition_value" real,
	"second_condition_type" varchar(50),
	"second_condition_value" real,
	"comparison_operator" varchar(10),
	"notification_channels" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_triggered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"exchange" varchar(100) DEFAULT 'delta' NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"encrypted_api_secret" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "indicator_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"indicator_type" varchar(50) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"value" real NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_type" varchar(50) NOT NULL,
	"channel_name" varchar(255) NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" bigint NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"symbols" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"webhook_url" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" bigint,
	"response" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_alert_logs_alert_id" ON "alert_logs" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "idx_alerts_watchlist_id" ON "alerts" USING btree ("watchlist_id");--> statement-breakpoint
CREATE INDEX "idx_alerts_symbol" ON "alerts" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_alerts_is_active" ON "alerts" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_indicator_data_symbol_timestamp" ON "indicator_data" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX "idx_notification_channels_type" ON "notification_channels" USING btree ("channel_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_price_history_symbol_timestamp" ON "price_history" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX "idx_watchlists_name" ON "watchlists" USING btree ("name");