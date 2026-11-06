import "server-only";

import { getDb } from "@/lib/db";
import { testConnection } from "@/lib/posthog/client";
import { getSecretBox } from "@/lib/secrets";

import { createConnectionService, type ConnectionService } from "./service";

export type { ConnectionSummary } from "./service";

let service: ConnectionService | undefined;

/** The app's connection service, wired to the real database, secrets and PostHog. */
export function getConnectionService(): ConnectionService {
  service ??= createConnectionService({
    db: getDb(),
    secrets: () => getSecretBox(),
    testConnection: (target) => testConnection(target),
  });
  return service;
}
