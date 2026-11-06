import { KeyRoundIcon, PlugIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AddConnectionButton } from "@/components/connections/add-connection-button";
import { ConnectionActions } from "@/components/connections/connection-actions";
import type { SecretMode } from "@/components/connections/connection-form-dialog";
import { SourceTile } from "@/components/connections/source-tile";
import { EmptyState, PageHeader, SectionLabel } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/user";
import { getConnectionService, type ConnectionSummary } from "@/lib/connections";
import type { ConnectionType } from "@/lib/connections/config";
import type { ConnectionStatus } from "@/lib/db/schema";
import { formatRelative } from "@/lib/format";
import { localHostsAllowed } from "@/lib/net/guarded-socket";
import { getSecretMode } from "@/lib/secrets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Data Connections" };

export default function ConnectionsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <PageHeader
        title="Data Connections"
        description="Connect your analytics and databases. Prism only runs read-only queries against them to build live dashboards."
      />
      <Suspense fallback={<ConnectionsSkeleton />}>
        <ConnectionsContent />
      </Suspense>
    </div>
  );
}

/** Reads the user and their connections, so it streams in behind the boundary. */
async function ConnectionsContent() {
  const user = await requireUser();
  const connections = await getConnectionService().list(user.id);
  const secretMode = getSecretMode();
  const allowLocal = localHostsAllowed();
  const now = new Date();

  return (
    <>
      <section aria-labelledby="your-connections">
        <SectionLabel id="your-connections">Your connections</SectionLabel>
        {connections.length === 0 ? (
          <EmptyState
            icon={PlugIcon}
            title="No connections yet"
            description="Add a source below to get started."
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                secretMode={secretMode}
                allowLocal={allowLocal}
                now={now}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="available-sources" className="mt-10">
        <SectionLabel id="available-sources">Available sources</SectionLabel>
        <ul className="divide-y rounded-xl border">
          {SOURCES.map((source) => (
            <li key={source.type} className="flex items-center gap-3 p-3.5">
              <SourceTile label={source.tile} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{source.name}</p>
                <p className="truncate text-sm text-muted-foreground">{source.description}</p>
              </div>
              <AddConnectionButton source={source.type} secretMode={secretMode} allowLocal={allowLocal} />
            </li>
          ))}
        </ul>
      </section>

      <StorageNote secretMode={secretMode} />
    </>
  );
}

const SOURCES: { type: ConnectionType; name: string; tile: string; description: string }[] = [
  { type: "posthog", name: "PostHog", tile: "PH", description: "Events · Persons · Sessions · HogQL" },
  { type: "postgres", name: "Postgres", tile: "PG", description: "Any database reachable on the public internet" },
];

function ConnectionRow({
  connection,
  secretMode,
  allowLocal,
  now,
}: {
  connection: ConnectionSummary;
  secretMode: SecretMode;
  allowLocal: boolean;
  now: Date;
}) {
  const details = [
    connection.source,
    connection.detail,
    connection.credentialHint,
    `checked ${formatRelative(connection.lastCheckedAt, now)}`,
  ];

  return (
    <li className="flex items-center gap-3 p-3.5">
      <SourceTile label={connection.tile} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{connection.name}</p>
        <p className="truncate text-sm text-muted-foreground">{details.join(" · ")}</p>
      </div>
      <StatusBadge status={connection.status} />
      <ConnectionActions
        connection={{
          id: connection.id,
          name: connection.name,
          type: connection.type,
          apps: connection.apps,
        }}
        secretMode={secretMode}
        allowLocal={allowLocal}
      />
    </li>
  );
}

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  ok: { label: "Connected", dot: "bg-emerald-500" },
  invalid: { label: "Invalid", dot: "bg-red-500" },
  unavailable: { label: "Unavailable", dot: "bg-amber-500" },
};

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const { label, dot } = STATUS[status];
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

function StorageNote({ secretMode }: { secretMode: SecretMode }) {
  const text =
    secretMode === "kms"
      ? "Keys and passwords are encrypted with KMS and never leave the server."
      : secretMode === "plaintext"
        ? "Keys and passwords never leave the server. In local development they're stored unencrypted."
        : "Secret storage isn't set up on this server yet.";
  return (
    <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
      <KeyRoundIcon className="size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

function ConnectionsSkeleton() {
  return (
    <div aria-busy className="space-y-10">
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-[4.25rem] w-full rounded-xl" />
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-[4.25rem] w-full rounded-xl" />
      </div>
    </div>
  );
}
