import { KeyRoundIcon, LockIcon, PlugIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ConnectionActions } from "@/components/connections/connection-actions";
import { ConnectorCatalog } from "@/components/connections/connector-catalog";
import { SignInResult } from "@/components/connections/sign-in-result";
import { DemoDatasetSwitch } from "@/components/connections/demo-dataset-switch";
import type { SecretMode } from "@/components/connections/connection-form-dialog";
import { SourceTile } from "@/components/connections/source-tile";
import { UsedBy } from "@/components/connections/used-by";
import { EmptyState, PageHeader, SectionLabel } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getConnectionService, type ConnectionSummary, type DemoDatasetSummary } from "@/lib/connections";
import type { ConnectionStatus } from "@/lib/db/schema";
import { formatRelative } from "@/lib/format";
import { getOrgService, requireMemberOf } from "@/lib/orgs";
import { canManageConnections } from "@/lib/orgs/access";
import { getSecretMode } from "@/lib/secrets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Data Connections" };

type Params = Promise<{ orgId: string }>;

export default function ConnectionsPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <PageHeader
        title="Data Connections"
        description="Connect your analytics and databases. OpenDashboards only runs read-only queries against them to build live dashboards."
      />
      <Suspense fallback={<ConnectionsSkeleton />}>
        <ConnectionsContent params={params} />
      </Suspense>
    </div>
  );
}

/** Reads the user and their connections, so it streams in behind the boundary. */
async function ConnectionsContent({ params }: { params: Params }) {
  const member = await requireMemberOf((await params).orgId);
  const service = getConnectionService();
  const [all, demos, org] = await Promise.all([
    service.list(member),
    service.listDemoDatasets(member),
    getOrgService().get(member.userId, member.orgId),
  ]);
  // Who serves whom only matters once someone else is here (or is about to be): alone, there's nobody to share with.
  const shared = (org?.members.length ?? 1) + (org?.invites.length ?? 0) > 1;
  const team = shared ? member.orgName : null;
  const canManage = canManageConnections(member.role);
  // Installed demo datasets are listed with their switch below, not here.
  const connections = all.filter((connection) => !connection.demo);
  const secretMode = getSecretMode();
  const now = new Date();

  return (
    <>
      <SignInResult />
      <section aria-labelledby="your-connections">
        <SectionLabel id="your-connections">{team ? `Connections in ${team}` : "Your connections"}</SectionLabel>
        {connections.length === 0 ? (
          <EmptyState
            icon={PlugIcon}
            title="No connections yet"
            description={canManage ? "Add a source below to get started." : "An editor or admin of this workspace can add one."}
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                secretMode={secretMode}
                now={now}
                team={team}
              />
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <section aria-labelledby="add-connection" className="mt-10">
          <SectionLabel id="add-connection">Add a connection</SectionLabel>
          {team && (
            <p className="-mt-1 mb-3 text-sm text-muted-foreground">
              A key or password serves everyone in {team}. A sign-in is yours alone until you share it.
            </p>
          )}
          <ConnectorCatalog secretMode={secretMode} />
        </section>
      )}

      {canManage && demos.length > 0 && (
        <section aria-labelledby="demo-datasets" className="mt-10">
          <SectionLabel id="demo-datasets">Demo datasets</SectionLabel>
          <p className="-mt-1 mb-3 text-sm text-muted-foreground">
            Sample data to try OpenDashboards with. Install one to use it like any connection.
          </p>
          <ul className="divide-y rounded-xl border">
            {demos.map((demo) => (
              <DemoRow key={demo.key} demo={demo} />
            ))}
          </ul>
        </section>
      )}

      <StorageNote secretMode={secretMode} />
    </>
  );
}


function ConnectionRow({
  connection,
  secretMode,
  now,
  team,
}: {
  connection: ConnectionSummary;
  secretMode: SecretMode;
  now: Date;
  team: string | null;
}) {
  const signedIn = connection.signIn === "oauth";
  const details = [
    connection.source,
    connection.detail,
    connection.credentialHint,
    // Whose account a shared sign-in runs as, and who added anything that isn't the reader's own.
    ...(team && connection.addedBy
      ? [signedIn ? `signed in by ${connection.addedBy} · everyone queries as them` : `added by ${connection.addedBy}`]
      : []),
    ...(team && signedIn && connection.mine && connection.sharing === "org" ? ["everyone queries as you"] : []),
    `checked ${formatRelative(connection.lastCheckedAt, now)}`,
  ];

  return (
    <li className="p-3.5">
      <div className="flex items-center gap-3">
        <SourceTile label={connection.tile} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{connection.name}</p>
          <p className="truncate text-sm text-muted-foreground">{details.join(" · ")}</p>
        </div>
        {team && <SharingBadge sharing={connection.sharing} />}
        <StatusBadge status={connection.status} />
        {connection.canManage && (
          <ConnectionActions
            connection={{
              id: connection.id,
              name: connection.name,
              type: connection.type,
              apps: connection.apps,
              signIn: connection.signIn,
              sharing: connection.sharing,
              mine: connection.mine,
            }}
            secretMode={secretMode}
            team={team}
          />
        )}
      </div>
      <UsedBy apps={connection.apps} />
    </li>
  );
}

function DemoRow({ demo }: { demo: DemoDatasetSummary }) {
  return (
    <li className="p-3.5">
      <div className="flex items-center gap-3">
        <SourceTile label="DM" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{demo.name}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{demo.description}</p>
        </div>
        <DemoDatasetSwitch
          dataset={demo.key}
          name={demo.name}
          installed={demo.connectionId !== null}
          apps={demo.apps}
        />
      </div>
      <UsedBy apps={demo.apps} />
    </li>
  );
}

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  ok: { label: "Connected", dot: "bg-emerald-500" },
  invalid: { label: "Invalid", dot: "bg-red-500" },
  unavailable: { label: "Unavailable", dot: "bg-amber-500" },
};

/** With others in the workspace: whether a connection serves everyone, or only the person who signed in. */
function SharingBadge({ sharing }: { sharing: ConnectionSummary["sharing"] }) {
  const Icon = sharing === "org" ? UsersIcon : LockIcon;
  return (
    <span className="hidden shrink-0 items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] text-neutral-600 sm:flex">
      <Icon className="size-3" aria-hidden />
      {sharing === "org" ? "Everyone" : "Only you"}
    </span>
  );
}

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
