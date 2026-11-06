import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// An explicit DATABASE_URL (e.g. the test database) wins over .env.local.
config({ path: ".env.local", quiet: true });

// No migrations while Prism is being built: `pnpm db:reset` recreates the
// tables from the schema.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
