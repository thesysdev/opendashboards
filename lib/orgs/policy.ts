import type { OrgRole } from "@/lib/db/schema";

/*
 * Who may do what, as one table: resource → action → rule. A rule's `allow`
 * is a pure function of facts loaded from the database (lib/orgs/access),
 * never from the browser; `denied` is what the person is told when it says
 * no. Services call `decide`; pages and the sidebar call `can`. Nothing else
 * decides access. No server code here: it runs in the browser too.
 *
 * Checks on the data itself (the last admin can't leave, a connection in use
 * can't be deleted, a guest can't be added while the app uses a personal
 * sign-in) aren't permissions: they stay in the services.
 */

// ── Facts: what a rule may look at ──────────────────────────────────────────

/** How someone gets into an app: theirs, or the higher of general access and what they were given by name. */
export type AppAccess = "owner" | "edit" | "view";

/** Signed in, nothing else known: only for creating a workspace. */
export type AnyoneFacts = { kind: "anyone" };

/** The caller in a workspace. role null: not a member. */
export type WorkspaceFacts = { kind: "workspace"; role: OrgRole | null };

export type AppFacts = {
  kind: "app";
  /** The caller's role in the app's workspace. null: not a member (a guest from outside, or nobody). */
  role: OrgRole | null;
  /** How they get in. null: no way in. */
  access: AppAccess | null;
  /** Let in by email, not through the workspace. */
  guest: boolean;
};

/**
 * What a connection is, fixed when it's added:
 * - key: an API key, password or service account, shared with the workspace.
 * - signInShared: one person's sign-in, shared with the workspace: everyone's queries run as them.
 * - signInEach: requires sign-in: each member signs in with their own account.
 */
export type ConnectionKind = "key" | "signInShared" | "signInEach";

export type ConnectionFacts = {
  kind: "connection";
  /** The caller's role in the connection's workspace. null: not a member. */
  role: OrgRole | null;
  /** They added it. */
  own: boolean;
  /** They hold its sign-in: the one of a shared sign-in, or their own of one that requires sign-in. */
  signedIn: boolean;
  /** For a shared sign-in: nobody holds it now (whoever signed in signed out or left). */
  empty: boolean;
  connection: ConnectionKind;
};

/** A Build chat. Each person's own: sharing an app never shares its chats. */
export type ThreadFacts = { kind: "thread"; own: boolean };

export type Facts = AnyoneFacts | WorkspaceFacts | AppFacts | ConnectionFacts | ThreadFacts;

// ── Decisions ───────────────────────────────────────────────────────────────

export type Allowed = { allowed: true };
export type Denied = {
  allowed: false;
  /** What the person is told. */
  reason: string;
  /** not_found when they can't see the thing at all, so its existence isn't revealed. */
  code: "not_found" | "forbidden";
};
export type Decision = Allowed | Denied;

type Rule<F extends Facts> = {
  allow: (facts: F) => boolean;
  /** Told to someone who can see the thing but may not do this: one message, or one per case. */
  denied: string | ((facts: F) => string);
  /**
   * Who is told the thing exists when refused. By default, whoever can see
   * it (`sees`); a rule narrows or widens that only where it always has.
   */
  visibleTo?: (facts: F) => boolean;
};

type Resource<Rules> = {
  /** Told to someone who can't see it, or when it doesn't exist. */
  notFound: string;
  actions: Rules;
};

// ── Building blocks ─────────────────────────────────────────────────────────

type HasRole = { role: OrgRole | null };
const member = (f: HasRole) => f.role !== null;
const builder = (f: HasRole) => f.role === "admin" || f.role === "editor";
const admin = (f: HasRole) => f.role === "admin";

const canView = (f: AppFacts) => f.access !== null;
/** Theirs or shared to edit, and their role lets them build: a viewer never does. */
const canChange = (f: AppFacts) => (f.access === "owner" || f.access === "edit") && builder(f);

/** Every member sees every connection of their workspace: which ones they can query with is the credential's business. */
const connectionVisible = (f: ConnectionFacts) => member(f);
/**
 * Renaming, testing or deleting it. A key is the workspace's: any editor or
 * admin. A sign-in is someone's account: whoever signed in (for one that
 * requires sign-in, whoever added it), or an admin.
 */
const manages = (f: ConnectionFacts) => {
  switch (f.connection) {
    case "key":
      return builder(f);
    case "signInShared":
      return member(f) && (f.signedIn || admin(f));
    case "signInEach":
      return member(f) && (f.own || admin(f));
  }
};
const notManaging = (f: ConnectionFacts) => {
  switch (f.connection) {
    case "key":
      return EDITORS_ONLY;
    case "signInShared":
      return "Only whoever signed in to this connection, or an admin, can change it.";
    case "signInEach":
      return "Only whoever added this connection, or an admin, can change it.";
  }
};
/**
 * Signing in to it. One that requires sign-in: any member, as themselves. A
 * shared one replaces the one sign-in everyone runs as: whoever holds it or an
 * admin, or any editor once nobody does.
 */
const mayRunAs = (f: ConnectionFacts) => {
  switch (f.connection) {
    case "key":
      return false;
    case "signInShared":
      return member(f) && (f.signedIn || admin(f) || (f.empty && builder(f)));
    case "signInEach":
      return member(f);
  }
};

const NO_WORKSPACE = "This workspace doesn't exist, or you aren't a member.";
const NO_APP = "This app doesn't exist or was deleted.";
const NO_CONNECTION = "This connection doesn't exist or was deleted.";

const ADMINS_ONLY = "Only an admin of this workspace can do that.";
const VIEW_ONLY = "You can view this app, but you can't change it.";
const NOT_SHARING = "You can view this app, but you can't change who it's shared with.";
const NO_BUILDING = "You can view this app, but you can't build in it.";
const EDITORS_ONLY = "Only an editor or admin of this workspace can change its connections.";

/** A rule over one kind of facts: the type names exactly what each action may look at. */
const onAnyone = (rule: Rule<AnyoneFacts>) => rule;
const onWorkspace = (rule: Rule<WorkspaceFacts>) => rule;
const onApp = (rule: Rule<AppFacts>) => rule;
const onConnection = (rule: Rule<ConnectionFacts>) => rule;
const onThread = (rule: Rule<ThreadFacts>) => rule;

// ── The policy ──────────────────────────────────────────────────────────────

const policy = {
  workspace: {
    notFound: NO_WORKSPACE,
    actions: {
      create: onAnyone({ allow: () => true, denied: "" }),
      view: onWorkspace({ allow: member, denied: NO_WORKSPACE }),
      update: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
      delete: onWorkspace({ allow: admin, denied: "Only an admin can delete this workspace." }),
      leave: onWorkspace({ allow: member, denied: NO_WORKSPACE }),
    },
  },

  /** The workspace's plan: every member sees it and its usage; only admins pay, change or cancel it. */
  billing: {
    notFound: NO_WORKSPACE,
    actions: {
      view: onWorkspace({ allow: member, denied: NO_WORKSPACE }),
      update: onWorkspace({ allow: admin, denied: "Only an admin can manage billing." }),
    },
  },

  member: {
    notFound: NO_WORKSPACE,
    actions: {
      view: onWorkspace({ allow: member, denied: NO_WORKSPACE }),
      create: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
      update: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
      delete: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
    },
  },

  invite: {
    notFound: NO_WORKSPACE,
    actions: {
      view: onWorkspace({ allow: member, denied: NO_WORKSPACE }),
      create: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
      update: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
      delete: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
    },
  },

  app: {
    notFound: NO_APP,
    actions: {
      create: onWorkspace({ allow: builder, denied: VIEW_ONLY }),
      view: onApp({ allow: canView, denied: NO_APP }),
      update: onApp({ allow: canChange, denied: VIEW_ONLY }),
      delete: onApp({ allow: (f) => f.access === "owner", denied: "Only the app's owner can delete it." }),
      build: onApp({ allow: canChange, denied: NO_BUILDING }),
      // Refused as if it didn't exist. The connection must also pass connection.use.
      addConnection: onApp({ allow: canChange, denied: VIEW_ONLY, visibleTo: canChange }),
    },
  },

  /** General access, and members the app is shared with by name. */
  appSharing: {
    notFound: NO_APP,
    actions: {
      view: onApp({ allow: canChange, denied: NOT_SHARING }),
      create: onApp({ allow: canChange, denied: NOT_SHARING }),
      update: onApp({ allow: canChange, denied: NOT_SHARING }),
      delete: onApp({ allow: canChange, denied: VIEW_ONLY }),
    },
  },

  /** People outside the workspace who may view one app, by email. */
  guest: {
    notFound: NO_APP,
    actions: {
      view: onApp({ allow: canChange, denied: NOT_SHARING }),
      viewAll: onWorkspace({ allow: admin, denied: ADMINS_ONLY }),
      create: onApp({ allow: canChange, denied: NOT_SHARING }),
      // An admin may remove a guest from any app in their workspace, even one they can't open: oversight.
      delete: onApp({
        allow: (f) => canChange(f) || admin(f),
        denied: VIEW_ONLY,
        // Told it exists: a member who can open the app, or an admin. A guest from outside isn't.
        visibleTo: (f) => (canView(f) && member(f)) || admin(f),
      }),
    },
  },

  /** Always follows its app: nothing is shared per dashboard. */
  dashboard: {
    notFound: "This dashboard doesn't exist or was deleted.",
    actions: {
      view: onApp({ allow: canView, denied: NO_APP }),
      create: onApp({ allow: canChange, denied: VIEW_ONLY, visibleTo: canChange }),
      update: onApp({ allow: canChange, denied: VIEW_ONLY, visibleTo: canChange }),
      rename: onApp({ allow: canChange, denied: VIEW_ONLY, visibleTo: canChange }),
      delete: onApp({ allow: canChange, denied: VIEW_ONLY, visibleTo: canChange }),
    },
  },

  connection: {
    notFound: NO_CONNECTION,
    actions: {
      create: onWorkspace({ allow: builder, denied: EDITORS_ONLY }),
      view: onConnection({ allow: connectionVisible, denied: NO_CONNECTION }),
      /** Query it. One that requires sign-in then needs the caller's own sign-in, which isn't a permission. */
      use: onConnection({ allow: connectionVisible, denied: NO_CONNECTION }),
      update: onConnection({ allow: manages, denied: notManaging }),
      delete: onConnection({ allow: manages, denied: notManaging }),
      /** Sign in, or again: as themselves for one that requires sign-in, as the one everyone runs as for a shared one. */
      signIn: onConnection({
        allow: mayRunAs,
        denied: (f) =>
          f.connection === "key"
            ? "This connection uses a key, not a sign-in."
            : "Only whoever signed in to this connection, or an admin, can sign in to it again.",
      }),
      /** Whatever their role, a viewer's included: nobody keeps querying as someone against their will. */
      signOut: onConnection({
        allow: (f) => member(f) && f.signedIn && f.connection !== "key",
        denied: "You aren't signed in to this connection.",
      }),
    },
  },

  sampleData: {
    notFound: NO_CONNECTION,
    actions: {
      create: onWorkspace({ allow: builder, denied: EDITORS_ONLY }),
      delete: onWorkspace({ allow: builder, denied: EDITORS_ONLY }),
    },
  },

  thread: {
    notFound: NO_APP,
    actions: {
      // Chatting is building: refused as if the app didn't exist.
      view: onApp({ allow: canChange, denied: NO_BUILDING, visibleTo: canChange }),
      create: onApp({ allow: canChange, denied: NO_BUILDING, visibleTo: canChange }),
      // Only ever your own, whatever your role now.
      update: onThread({ allow: (f) => f.own, denied: NO_APP }),
      delete: onThread({ allow: (f) => f.own, denied: NO_APP }),
    },
  },
} satisfies { [resource: string]: Resource<{ [action: string]: Rule<never> }> };

// ── Types derived from the table ────────────────────────────────────────────

type Policy = typeof policy;
export type ResourceName = keyof Policy;
export type Action<R extends ResourceName> = keyof Policy[R]["actions"] & string;
/** The facts an action's rule takes: `can("app", "delete", …)` only accepts AppFacts. */
export type FactsFor<R extends ResourceName, A extends Action<R>> =
  Policy[R]["actions"][A] extends { allow: (facts: infer F) => boolean } ? F : never;

// ── Asking ──────────────────────────────────────────────────────────────────

/** Whether the caller can see what the facts are about at all. */
function sees(facts: Facts): boolean {
  switch (facts.kind) {
    case "anyone":
      return true;
    case "workspace":
      return member(facts);
    case "app":
      return canView(facts);
    case "connection":
      return connectionVisible(facts);
    case "thread":
      return facts.own;
  }
}

export function decide<R extends ResourceName, A extends Action<R>>(
  resource: R,
  action: A,
  /** null: the thing doesn't exist. */
  facts: FactsFor<R, A> | null,
): Decision {
  const { notFound, actions } = policy[resource] as Resource<Record<string, Rule<Facts>>>;
  const rule = actions[action];
  const known = facts as Facts | null;
  if (known !== null && rule.allow(known)) return { allowed: true };
  const visible = known !== null && (rule.visibleTo ?? sees)(known);
  if (!visible) return { allowed: false, code: "not_found", reason: notFound };
  return { allowed: false, code: "forbidden", reason: typeof rule.denied === "string" ? rule.denied : rule.denied(known!) };
}

/** For pages and the sidebar: whether to offer something. */
export function can<R extends ResourceName, A extends Action<R>>(resource: R, action: A, facts: FactsFor<R, A> | null): boolean {
  return decide(resource, action, facts).allowed;
}

/** A refusal in the shape every service returns. */
export const refusal = (denied: Denied) => ({ ok: false as const, error: { code: denied.code, message: denied.reason } });

/** For analytics: how someone relates to an app they opened. Its owner, a member who can edit it, one who can only view it, or a guest. */
export function viewerRole(facts: Pick<AppFacts, "access" | "guest">): "owner" | "editor" | "viewer" | "guest" {
  if (facts.guest) return "guest";
  return facts.access === "owner" ? "owner" : facts.access === "edit" ? "editor" : "viewer";
}
