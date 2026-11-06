import "server-only";

import { getDb } from "@/lib/db";
import { testPostgresConnection } from "@/lib/postgres/client";
import { testConnection } from "@/lib/posthog/client";
import { getSecretBox } from "@/lib/secrets";

import { createConnectionService, type ConnectionService } from "./service";

export type { ConnectionSummary, ConnectionWarning } from "./service";

let service: ConnectionService | undefined;

/** The app's connection service, wired to the real database, secrets, PostHog and Postgres. */
export function getConnectionService(): ConnectionService {
  service ??= createConnectionService({
    db: getDb(),
    secrets: () => getSecretBox(),
    testConnection: (target) => testConnection(target),
    testPostgres: (target) => testPostgresConnection(target),
  });
  return service;
}
