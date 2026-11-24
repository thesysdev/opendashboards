CREATE TYPE "public"."app_member_access" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."app_team_access" AS ENUM('private', 'view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."connection_sharing" AS ENUM('personal', 'org');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "app_guests" (
	"app_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_guests_app_id_email_pk" PRIMARY KEY("app_id","email")
);
--> statement-breakpoint
CREATE TABLE "app_members" (
	"app_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"access" "app_member_access" NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_members_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "connection_sign_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"secret" jsonb NOT NULL,
	"status" "connection_status" NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "org_role" NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invites_org_id_email_pk" PRIMARY KEY("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "org_role" NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_connections" DROP CONSTRAINT "data_connections_secret_or_demo";--> statement-breakpoint
DROP INDEX "data_connections_user_demo_idx";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "team_access" "app_team_access" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_connections" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "data_connections" ADD COLUMN "sharing" "connection_sharing" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_oauth_sign_ins" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_sign_ins" ADD COLUMN "sharing" "connection_sharing" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_guests" ADD CONSTRAINT "app_guests_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_members" ADD CONSTRAINT "app_members_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_sign_ins" ADD CONSTRAINT "connection_sign_ins_connection_id_data_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_guests_email_idx" ON "app_guests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "app_members_user_id_idx" ON "app_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_sign_ins_connection_user_idx" ON "connection_sign_ins" USING btree ("connection_id","user_id");--> statement-breakpoint
CREATE INDEX "connection_sign_ins_user_id_idx" ON "connection_sign_ins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_invites_email_idx" ON "org_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "org_members_user_id_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connections" ADD CONSTRAINT "data_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_sign_ins" ADD CONSTRAINT "mcp_oauth_sign_ins_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_org_id_idx" ON "apps" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "data_connections_org_id_idx" ON "data_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_connections_org_demo_idx" ON "data_connections" USING btree ("org_id","demo_dataset");--> statement-breakpoint
-- Backfill (written by hand): everyone who had anything before workspaces gets
-- a workspace of their own holding all of it, so nobody sees a change.
CREATE TEMPORARY TABLE "_workspace_owners" ON COMMIT DROP AS
SELECT owners.user_id, gen_random_uuid() AS org_id
FROM (
	SELECT "user_id" FROM "apps"
	UNION SELECT "user_id" FROM "data_connections"
	UNION SELECT "user_id" FROM "dashboards"
	UNION SELECT "user_id" FROM "app_threads"
	UNION SELECT "user_id" FROM "mcp_oauth_sign_ins"
) AS owners;--> statement-breakpoint
-- A placeholder name: it becomes "<name>'s workspace" the first time they sign in, when we learn their email.
INSERT INTO "orgs" ("id", "name", "created_by") SELECT "org_id", 'My workspace', "user_id" FROM "_workspace_owners";--> statement-breakpoint
INSERT INTO "org_members" ("org_id", "user_id", "role", "added_by")
SELECT "org_id", "user_id", 'admin', "user_id" FROM "_workspace_owners";--> statement-breakpoint
UPDATE "apps" SET "org_id" = o."org_id" FROM "_workspace_owners" o
WHERE o."user_id" = "apps"."user_id" AND "apps"."org_id" IS NULL;--> statement-breakpoint
-- A sign-in requires each member's own sign-in; keys and passwords are shared with the workspace.
UPDATE "data_connections" SET
	"org_id" = o."org_id",
	"sharing" = CASE WHEN "data_connections"."config" -> 'oauth' IS NOT NULL THEN 'personal'::"connection_sharing" ELSE 'org'::"connection_sharing" END
FROM "_workspace_owners" o
WHERE o."user_id" = "data_connections"."user_id" AND "data_connections"."org_id" IS NULL;--> statement-breakpoint
UPDATE "mcp_oauth_sign_ins" SET "org_id" = o."org_id" FROM "_workspace_owners" o
WHERE o."user_id" = "mcp_oauth_sign_ins"."user_id" AND "mcp_oauth_sign_ins"."org_id" IS NULL;
--> statement-breakpoint
-- A sign-in's tokens move to connection_sign_ins, as whoever signed in. They stay
-- sealed for the same user and connection, so they open as before.
INSERT INTO "connection_sign_ins" ("id", "connection_id", "user_id", "secret", "status", "last_checked_at", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "user_id", "secret", "status", "last_checked_at", "created_at", "updated_at"
FROM "data_connections"
WHERE "config" -> 'oauth' IS NOT NULL AND "secret" IS NOT NULL;--> statement-breakpoint
UPDATE "data_connections" SET "secret" = NULL WHERE "config" -> 'oauth' IS NOT NULL;--> statement-breakpoint
ALTER TABLE "data_connections" ADD CONSTRAINT "data_connections_secret_or_demo" CHECK (CASE WHEN "data_connections"."demo_dataset" IS NOT NULL THEN "data_connections"."secret" IS NULL WHEN "data_connections"."config" -> 'oauth' IS NULL THEN "data_connections"."secret" IS NOT NULL ELSE true END);
