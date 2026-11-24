CREATE TABLE "org_billing" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan" text,
	"interval" text,
	"status" text,
	"seats" integer DEFAULT 1 NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_by" text DEFAULT 'stripe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_connections" ADD COLUMN "created_by" text;--> statement-breakpoint
-- Rows from before: whoever owns the app added them (its owner picked them, or the agent queried them for them).
UPDATE "app_connections" SET "created_by" = "apps"."user_id" FROM "apps" WHERE "apps"."id" = "app_connections"."app_id";--> statement-breakpoint
ALTER TABLE "org_billing" ADD CONSTRAINT "org_billing_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_billing_customer_idx" ON "org_billing" USING btree ("stripe_customer_id");