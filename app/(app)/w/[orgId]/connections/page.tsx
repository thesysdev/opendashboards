import { KeyRoundIcon, LogInIcon, PlugIcon, UsersIcon } from "lucide-react";
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
import { getConnectionService, type ConnectionSummary } from "@/lib/connections";
import type { ConnectionStatus } from "@/lib/db/schema";
import { getOrgService, requireMemberOf } from "@/lib/orgs";
import { asWorkspace } from "@/lib/orgs/access";
import { can } from "@/lib/orgs/policy";
import { getSecretMode } from "@/lib/secrets";
import { hiddenSources } from "@/lib/sources/flags";
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
  const [connections, demos, org, hidden] = await Promise.all([
    service.list(member),
    service.listDemoDatasets(member),
    getOrgService().get(member.userId, member.orgId),
    hiddenSources(member),
  ]);
  // Who serves whom only matters once someone else is here (or is about to be): alone, there's nobody to share with.
  const shared = (org?.members.length ?? 1) + (org?.invites.length ?? 0) > 1;
  const team = shared ? member.orgName : null;
  // Viewers can't add, change or build on connections: they only use what's here.
  const workspace = asWorkspace(member.role);
  const canAdd = can("connection", "create", workspace);
  const canBuild = can("app", "create", workspace);
  const sampleData = { add: can("sampleData", "create", workspace), remove: can("sampleData", "delete", workspace) };
  const secretMode = getSecretMode();
  // Sample data that isn't added yet: offered on the empty state, or as a catalog tile once there are connections.
  const sample = demos.find((demo) => demo.connectionId === null);

  return (
    <>
      <SignInResult />
      <section aria-labelledby="your-connections">
        <SectionLabel id="your-connections">{team ? `Connections in ${team}` : "Your connections"}</SectionLabel>
        {connections.length === 0 ? (
          <EmptyState
            icon={PlugIcon}
            title="No connections yet"
            description={
              !canAdd
                ? "An editor or admin of this workspace can add one."
                : sample
                  ? "Add a source below, or try OpenDashboards with sample data."
                  : "Add a source below to get started."
            }
            action={sampleData.add && sample && <AddSampleDataButton dataset={sample.key} name={sample.name} />}
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                secretMode={secretMode}
                team={team}
                canBuild={canBuild}
                canRemoveSample={sampleData.remove}
              />
            ))}
          </ul>
        )}
      </section>

      {canAdd && (
        <section aria-labelledby="add-connection" className="mt-10">
          <SectionLabel id="add-connection">Add a connection</SectionLabel>
          {team && (
            <p className="-mt-1 mb-3 text-sm text-muted-foreground">
              A key or password is shared with everyone in {team}. A sign-in is either shared with the workspace, so everyone
              queries as you, or requires sign-in, so everyone signs in with their own account. That can&apos;t be changed later.
            </p>
          )}
          <ConnectorCatalog
            secretMode={secretMode}
            hidden={hidden}
            sampleData={
              sample &&
              connections.length > 0 && <SampleDataTile dataset={sample.key} name={sample.name} summary={sample.summary} />
            }
          />
        </section>
      )}

      <StorageNote secretMode={secretMode} />
    </>
  );
}

/**
 * One connection, sample data included: the same row for every source, with
 * Build to start an app on it. A working connection gets only a faint dot;
 * a broken one says what's wrong. With others in the workspace, it also says
 * whether it serves everyone, and whose account a shared sign-in runs as.
 */
function ConnectionRow({
  connection,
  secretMode,
  team,
  canBuild,
  canRemoveSample,
}: {
  connection: ConnectionSummary;
  secretMode: SecretMode;
  /** The workspace's name, when it has other people. Null when there's nobody to share with. */
  team: string | null;
  /** Whether the reader may start an app on a connection: not a viewer. */
  canBuild: boolean;
  /** Whether the reader may remove sample data from the workspace. */
  canRemoveSample: boolean;
}) {
  const { facts, kind } = connection;
  const detail = connection.demo
    ? `Sample data · ${connection.demo.summary}`
    : [
        connection.source,
        connection.detail,
        // Whose account a shared sign-in runs as; who added a key that isn't the reader's own.
        ...(kind === "signInShared" && team && connection.signInStatus !== "none"
          ? [facts.signedIn ? "everyone queries as you" : `everyone queries as ${connection.signedInAs ?? "someone"}`]
          : []),
        ...(kind === "key" && team && connection.addedBy ? [`added by ${connection.addedBy}`] : []),
      ]
        .filter(Boolean)
        .join(" · ");
  // What the reader may do with it: each comes from the policy.
  const actions = {
    manage: connection.canManage,
    signIn: can("connection", "signIn", facts),
    signOut: can("connection", "signOut", facts),
  };

  return (
    <li className="p-3.5">
      <div className="flex items-center gap-3">
        <SourceTile label={connection.tile} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{connection.name}</span>
            {connection.signInStatus === null ? <Status status={connection.status} /> : <SignInStatus connection={connection} />}
          </p>
          <p className="truncate text-sm text-muted-foreground">{detail}</p>
        </div>
        {team && !connection.demo && <KindBadge kind={kind} />}
        {canBuild && <BuildButton connectionId={connection.id} name={connection.name} />}
        {connection.demo
          ? canRemoveSample && <SampleDataActions dataset={connection.demo.key} name={connection.name} apps={connection.apps} />
          : (actions.manage || actions.signIn || actions.signOut) && (
              <ConnectionActions
                connection={{
                  id: connection.id,
                  name: connection.name,
                  type: connection.type,
                  apps: connection.apps,
                  kind,
                  signedIn: connection.signInStatus !== "none" && facts.signedIn,
                }}
                actions={actions}
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

/**
 * A sign-in's state for the reader: the one it runs with, or theirs where
 * everyone signs in. On a phone only its dot shows, so the name keeps the room.
 */
function SignInStatus({ connection }: { connection: ConnectionSummary }) {
  const signedIn = connection.signInStatus === "signedIn";
  const { label, text, dot } = signedIn
    ? { label: connection.kind === "signInEach" ? "Signed in" : null, text: "text-muted-foreground", dot: "bg-emerald-500/50" }
    : connection.signInStatus === "expired"
      ? { label: "Sign-in expired", text: "text-red-600", dot: "bg-red-500" }
      : { label: connection.kind === "signInEach" ? "Not signed in" : "Nobody signed in", text: "text-amber-600", dot: "bg-amber-500" };
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-xs font-normal", text)}>
      {/* A problem reads as words on a wide screen; the working dot always shows. */}
      <span role="img" aria-label={label ?? "Connected"} className={cn("size-1.5 rounded-full", dot, !signedIn && "sm:hidden")} />
      {label && <span className="hidden sm:inline">{label}</span>}
    </span>
  );
}

/** With others in the workspace: shared with it (one credential for everyone), or requiring each person's own sign-in. */
function KindBadge({ kind }: { kind: ConnectionSummary["kind"] }) {
  const each = kind === "signInEach";
  const Icon = each ? LogInIcon : UsersIcon;
  return (
    <span className="hidden shrink-0 items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[0.6875rem] text-neutral-600 sm:flex">
      <Icon className="size-3" aria-hidden />
      {each ? "Requires sign-in" : "Shared with workspace"}
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
