import { KeyRoundIcon, PlugIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ConnectionActions } from "@/components/connections/connection-actions";
import { ConnectorCatalog } from "@/components/connections/connector-catalog";
import { SignInResult } from "@/components/connections/sign-in-result";
import { BuildButton } from "@/components/connections/build-button";
import { AddSampleDataButton, SampleDataActions, SampleDataTile } from "@/components/connections/sample-data";
import type { SecretMode } from "@/components/connections/connection-form-dialog";
import { SourceTile } from "@/components/connections/source-tile";
import { UsedBy } from "@/components/connections/used-by";
import { EmptyState, PageHeader, SectionLabel } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/user";
import { getConnectionService, type ConnectionSummary } from "@/lib/connections";
import type { ConnectionStatus } from "@/lib/db/schema";
import { getSecretMode } from "@/lib/secrets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Data Connections" };

export default function ConnectionsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <PageHeader
        title="Data Connections"
        description="Connect your analytics and databases. OpenDashboards only runs read-only queries against them to build live dashboards."
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
  const service = getConnectionService();
  const [connections, demos] = await Promise.all([service.list(user.id), service.listDemoDatasets(user.id)]);
  const secretMode = getSecretMode();
  // Sample data that isn't added yet: offered on the empty state, or as a catalog tile once there are connections.
  const sample = demos.find((demo) => demo.connectionId === null);

  return (
    <>
      <SignInResult />
      <section aria-labelledby="your-connections">
        <SectionLabel id="your-connections">Your connections</SectionLabel>
        {connections.length === 0 ? (
          <EmptyState
            icon={PlugIcon}
            title="No connections yet"
            description={
              sample ? "Add a source below, or try OpenDashboards with sample data." : "Add a source below to get started."
            }
            action={sample && <AddSampleDataButton dataset={sample.key} name={sample.name} />}
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {connections.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} secretMode={secretMode} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-connection" className="mt-10">
        <SectionLabel id="add-connection">Add a connection</SectionLabel>
        <ConnectorCatalog
          secretMode={secretMode}
          sampleData={
            sample &&
            connections.length > 0 && <SampleDataTile dataset={sample.key} name={sample.name} summary={sample.summary} />
          }
        />
      </section>

      <StorageNote secretMode={secretMode} />
    </>
  );
}

/**
 * One connection, sample data included: the same row for every source, with
 * Build to start an app on it. A working connection gets only a faint dot;
 * a broken one says what's wrong.
 */
function ConnectionRow({ connection, secretMode }: { connection: ConnectionSummary; secretMode: SecretMode }) {
  const detail = connection.demo
    ? `Sample data · ${connection.demo.summary}`
    : [connection.source, connection.detail].filter(Boolean).join(" · ");

  return (
    <li className="p-3.5">
      <div className="flex items-center gap-3">
        <SourceTile label={connection.tile} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{connection.name}</span>
            <Status status={connection.status} />
          </p>
          <p className="truncate text-sm text-muted-foreground">{detail}</p>
        </div>
        <BuildButton connectionId={connection.id} name={connection.name} />
        {connection.demo ? (
          <SampleDataActions dataset={connection.demo.key} name={connection.name} apps={connection.apps} />
        ) : (
          <ConnectionActions
            connection={{
              id: connection.id,
              name: connection.name,
              type: connection.type,
              apps: connection.apps,
              signIn: connection.signIn,
            }}
            secretMode={secretMode}
          />
        )}
      </div>
      <UsedBy apps={connection.apps} />
    </li>
  );
}

function Status({ status }: { status: ConnectionStatus }) {
  if (status === "ok") {
    return <span role="img" aria-label="Connected" className="size-1.5 shrink-0 rounded-full bg-emerald-500/50" />;
  }
  return (
    <span className={cn("shrink-0 text-xs font-normal", status === "invalid" ? "text-red-600" : "text-amber-600")}>
      {status === "invalid" ? "Invalid" : "Unavailable"}
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
