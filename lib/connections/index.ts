import "server-only";

import { getDb } from "@/lib/db";
import { getSecretBox } from "@/lib/secrets";
import { sourceFor } from "@/lib/sources";

import { createConnectionService, type ConnectionService } from "./service";

export type { ConnectionSummary, ConnectionWarning } from "./service";

let service: ConnectionService | undefined;

/** The app's connection service, wired to the real database, secrets and sources. */
export function getConnectionService(): ConnectionService {
  service ??= createConnectionService({
    db: getDb(),
    secrets: () => getSecretBox(),
    sources: sourceFor,
  });
  return service;
}
