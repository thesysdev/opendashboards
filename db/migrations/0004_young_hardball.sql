CREATE TABLE "mcp_oauth_sign_ins" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"secret" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_sign_ins" ADD CONSTRAINT "mcp_oauth_sign_ins_connection_id_data_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_sign_ins_user_id_idx" ON "mcp_oauth_sign_ins" USING btree ("user_id");