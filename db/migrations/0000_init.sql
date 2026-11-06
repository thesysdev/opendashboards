CREATE TYPE "public"."connection_status" AS ENUM('ok', 'invalid', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."connection_type" AS ENUM('posthog');--> statement-breakpoint
CREATE TYPE "public"."host_kind" AS ENUM('posthog_us', 'posthog_eu');--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "connection_type" NOT NULL,
	"host_kind" "host_kind" NOT NULL,
	"project_id" text NOT NULL,
	"secret" jsonb NOT NULL,
	"key_hint" text NOT NULL,
	"status" "connection_status" NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_connection_id_data_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_user_id_idx" ON "apps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apps_connection_id_idx" ON "apps" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "data_connections_user_id_idx" ON "data_connections" USING btree ("user_id");