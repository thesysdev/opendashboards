-- IF NOT EXISTS: the shared preview database got these values from an earlier numbering of this migration.
ALTER TYPE "public"."connection_type" ADD VALUE IF NOT EXISTS 'googleads' BEFORE 'mcp';--> statement-breakpoint
ALTER TYPE "public"."connection_type" ADD VALUE IF NOT EXISTS 'metaads' BEFORE 'mcp';
