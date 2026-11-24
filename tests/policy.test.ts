import { describe, expect, it } from "vitest";

import type { OrgRole } from "@/lib/db/schema";
import {
  decide,
  type AppAccess,
  type AppFacts,
  type ConnectionFacts,
  type ConnectionKind,
  type Decision,
  type ThreadFacts,
  type WorkspaceFacts,
} from "@/lib/orgs/policy";

/*
 * The whole permission table, decision by decision. Pure: no database. The
 * service tests check the same rules end to end; this pins every action for
 * every kind of person, including which refusals hide that something exists.
 */

type Outcome = "allowed" | "forbidden" | "not_found";
const outcome = (decision: Decision): Outcome => (decision.allowed ? "allowed" : decision.code);

const ws = (role: OrgRole | null): WorkspaceFacts => ({ kind: "workspace", role });
const app = (access: AppAccess | null, role: OrgRole | null, guest = false): AppFacts => ({ kind: "app", access, role, guest });
const conn = (
  role: OrgRole | null,
  connection: ConnectionKind,
  { own = false, signedIn = false, empty = false }: { own?: boolean; signedIn?: boolean; empty?: boolean } = {},
): ConnectionFacts => ({ kind: "connection", role, own, signedIn, empty, connection });
const thread = (own: boolean): ThreadFacts => ({ kind: "thread", own });

const A = "allowed";
const F = "forbidden";
const N = "not_found";

describe("workspace, members and invites", () => {
  const people = { admin: ws("admin"), editor: ws("editor"), viewer: ws("viewer"), outsider: ws(null) };
  const table: Array<[string, (f: WorkspaceFacts) => Decision, Record<keyof typeof people, Outcome>]> = [
    ["workspace.view", (f) => decide("workspace", "view", f), { admin: A, editor: A, viewer: A, outsider: N }],
    ["workspace.leave", (f) => decide("workspace", "leave", f), { admin: A, editor: A, viewer: A, outsider: N }],
    ["workspace.update", (f) => decide("workspace", "update", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["workspace.delete", (f) => decide("workspace", "delete", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["member.view", (f) => decide("member", "view", f), { admin: A, editor: A, viewer: A, outsider: N }],
    ["member.create", (f) => decide("member", "create", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["member.update", (f) => decide("member", "update", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["member.delete", (f) => decide("member", "delete", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["invite.view", (f) => decide("invite", "view", f), { admin: A, editor: A, viewer: A, outsider: N }],
    ["invite.create", (f) => decide("invite", "create", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["invite.update", (f) => decide("invite", "update", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["invite.delete", (f) => decide("invite", "delete", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["guest.viewAll", (f) => decide("guest", "viewAll", f), { admin: A, editor: F, viewer: F, outsider: N }],
    ["app.create", (f) => decide("app", "create", f), { admin: A, editor: A, viewer: F, outsider: N }],
    ["connection.create", (f) => decide("connection", "create", f), { admin: A, editor: A, viewer: F, outsider: N }],
    ["sampleData.create", (f) => decide("sampleData", "create", f), { admin: A, editor: A, viewer: F, outsider: N }],
    ["sampleData.delete", (f) => decide("sampleData", "delete", f), { admin: A, editor: A, viewer: F, outsider: N }],
  ];

  it.each(table)("%s", (_name, ask, expected) => {
    const actual = Object.fromEntries(Object.entries(people).map(([who, facts]) => [who, outcome(ask(facts))]));
    expect(actual).toEqual(expected);
  });

  it("lets anyone signed in create a workspace", () => {
    expect(decide("workspace", "create", { kind: "anyone" })).toEqual({ allowed: true });
  });
});

describe("apps, sharing, guests, dashboards and chats", () => {
  // How each person gets into the app, and their role in its workspace. A viewer's access is capped at view.
  const people = {
    ownerEditor: app("owner", "editor"),
    ownerViewer: app("owner", "viewer"),
    editEditor: app("edit", "editor"),
    viewEditor: app("view", "editor"),
    viewViewer: app("view", "viewer"),
    privateAdmin: app(null, "admin"),
    privateEditor: app(null, "editor"),
    guest: app("view", null, true),
    adminGuest: app("view", "admin", true),
  };
  type Row = Record<keyof typeof people, Outcome>;
  /** Whoever can change the app; everyone else who can open it is refused. */
  const changers: Row = {
    ownerEditor: A, ownerViewer: F, editEditor: A, viewEditor: F, viewViewer: F, privateAdmin: N, privateEditor: N, guest: F, adminGuest: F,
  };
  /** Whoever can change the app; anyone else is told it doesn't exist. */
  const changersHidden: Row = {
    ownerEditor: A, ownerViewer: N, editEditor: A, viewEditor: N, viewViewer: N, privateAdmin: N, privateEditor: N, guest: N, adminGuest: N,
  };
  const viewers: Row = {
    ownerEditor: A, ownerViewer: A, editEditor: A, viewEditor: A, viewViewer: A, privateAdmin: N, privateEditor: N, guest: A, adminGuest: A,
  };

  const table: Array<[string, (f: AppFacts) => Decision, Row]> = [
    ["app.view", (f) => decide("app", "view", f), viewers],
    ["app.update", (f) => decide("app", "update", f), changers],
    ["app.build", (f) => decide("app", "build", f), changers],
    ["app.addConnection", (f) => decide("app", "addConnection", f), changersHidden],
    [
      "app.delete",
      (f) => decide("app", "delete", f),
      { ownerEditor: A, ownerViewer: A, editEditor: F, viewEditor: F, viewViewer: F, privateAdmin: N, privateEditor: N, guest: F, adminGuest: F },
    ],
    ["appSharing.view", (f) => decide("appSharing", "view", f), changers],
    ["appSharing.create", (f) => decide("appSharing", "create", f), changers],
    ["appSharing.update", (f) => decide("appSharing", "update", f), changers],
    ["appSharing.delete", (f) => decide("appSharing", "delete", f), changers],
    ["guest.view", (f) => decide("guest", "view", f), changers],
    ["guest.create", (f) => decide("guest", "create", f), changers],
    [
      // Admins oversee every guest, even on an app they can't open. A guest from outside isn't told it exists.
      "guest.delete",
      (f) => decide("guest", "delete", f),
      { ownerEditor: A, ownerViewer: F, editEditor: A, viewEditor: F, viewViewer: F, privateAdmin: A, privateEditor: N, guest: N, adminGuest: A },
    ],
    ["dashboard.view", (f) => decide("dashboard", "view", f), viewers],
    ["dashboard.create", (f) => decide("dashboard", "create", f), changersHidden],
    ["dashboard.update", (f) => decide("dashboard", "update", f), changersHidden],
    ["dashboard.rename", (f) => decide("dashboard", "rename", f), changersHidden],
    ["dashboard.delete", (f) => decide("dashboard", "delete", f), changersHidden],
    ["thread.view", (f) => decide("thread", "view", f), changersHidden],
    ["thread.create", (f) => decide("thread", "create", f), changersHidden],
  ];

  it.each(table)("%s", (_name, ask, expected) => {
    const actual = Object.fromEntries(Object.entries(people).map(([who, facts]) => [who, outcome(ask(facts))]));
    expect(actual).toEqual(expected);
  });

  it("only ever lets you change or delete your own chats", () => {
    for (const action of ["update", "delete"] as const) {
      expect(outcome(decide("thread", action, thread(true)))).toBe(A);
      expect(outcome(decide("thread", action, thread(false)))).toBe(N);
    }
  });

  it("refuses an app that doesn't exist as not found", () => {
    expect(decide("app", "update", null)).toEqual({ allowed: false, code: "not_found", reason: "This app doesn't exist or was deleted." });
  });
});

describe("connections", () => {
  // Who is asking, about which kind: a key, a shared sign-in, or one that requires each member's own.
  const people = {
    keyEditor: conn("editor", "key"),
    keyViewer: conn("viewer", "key"),
    sharedHolderViewer: conn("viewer", "signInShared", { own: true, signedIn: true }),
    sharedOtherEditor: conn("editor", "signInShared"),
    sharedOtherAdmin: conn("admin", "signInShared"),
    sharedEmptyEditor: conn("editor", "signInShared", { empty: true }),
    eachAdderViewer: conn("viewer", "signInEach", { own: true, signedIn: true }),
    eachSignedInViewer: conn("viewer", "signInEach", { signedIn: true }),
    eachNotSignedInEditor: conn("editor", "signInEach"),
    eachOtherAdmin: conn("admin", "signInEach"),
    outsider: conn(null, "key"),
  };
  type Row = Record<keyof typeof people, Outcome>;
  const everyMember: Row = {
    keyEditor: A, keyViewer: A, sharedHolderViewer: A, sharedOtherEditor: A, sharedOtherAdmin: A, sharedEmptyEditor: A,
    eachAdderViewer: A, eachSignedInViewer: A, eachNotSignedInEditor: A, eachOtherAdmin: A, outsider: N,
  };
  // A key: any editor or admin. A shared sign-in: whoever holds it, or an admin. One that requires sign-in: whoever added it, or an admin.
  const managers: Row = {
    keyEditor: A, keyViewer: F, sharedHolderViewer: A, sharedOtherEditor: F, sharedOtherAdmin: A, sharedEmptyEditor: F,
    eachAdderViewer: A, eachSignedInViewer: F, eachNotSignedInEditor: F, eachOtherAdmin: A, outsider: N,
  };

  const table: Array<[string, (f: ConnectionFacts) => Decision, Row]> = [
    ["connection.view", (f) => decide("connection", "view", f), everyMember],
    ["connection.use", (f) => decide("connection", "use", f), everyMember],
    ["connection.update", (f) => decide("connection", "update", f), managers],
    ["connection.delete", (f) => decide("connection", "delete", f), managers],
    [
      "connection.signIn",
      (f) => decide("connection", "signIn", f),
      {
        keyEditor: F, keyViewer: F, sharedHolderViewer: A, sharedOtherEditor: F, sharedOtherAdmin: A, sharedEmptyEditor: A,
        eachAdderViewer: A, eachSignedInViewer: A, eachNotSignedInEditor: A, eachOtherAdmin: A, outsider: N,
      },
    ],
    [
      "connection.signOut",
      (f) => decide("connection", "signOut", f),
      {
        keyEditor: F, keyViewer: F, sharedHolderViewer: A, sharedOtherEditor: F, sharedOtherAdmin: F, sharedEmptyEditor: F,
        eachAdderViewer: A, eachSignedInViewer: A, eachNotSignedInEditor: F, eachOtherAdmin: F, outsider: N,
      },
    ],
  ];

  it.each(table)("%s", (_name, ask, expected) => {
    const actual = Object.fromEntries(Object.entries(people).map(([who, facts]) => [who, outcome(ask(facts))]));
    expect(actual).toEqual(expected);
  });
});

describe("what a refused person is told", () => {
  it.each<[string, Decision, Decision]>([
    [
      "an editor deleting someone else's app",
      decide("app", "delete", app("edit", "editor")),
      { allowed: false, code: "forbidden", reason: "Only the app's owner can delete it." },
    ],
    [
      "a viewer building",
      decide("app", "build", app("view", "viewer")),
      { allowed: false, code: "forbidden", reason: "You can view this app, but you can't build in it." },
    ],
    [
      "a viewer opening up an app",
      decide("appSharing", "update", app("view", "viewer")),
      { allowed: false, code: "forbidden", reason: "You can view this app, but you can't change who it's shared with." },
    ],
    [
      "an admin opening a private app",
      decide("app", "view", app(null, "admin")),
      { allowed: false, code: "not_found", reason: "This app doesn't exist or was deleted." },
    ],
    [
      "an editor renaming the workspace",
      decide("workspace", "update", ws("editor")),
      { allowed: false, code: "forbidden", reason: "Only an admin of this workspace can do that." },
    ],
    [
      "an editor deleting the workspace",
      decide("workspace", "delete", ws("editor")),
      { allowed: false, code: "forbidden", reason: "Only an admin can delete this workspace." },
    ],
    [
      "someone outside the workspace",
      decide("member", "view", ws(null)),
      { allowed: false, code: "not_found", reason: "This workspace doesn't exist, or you aren't a member." },
    ],
    [
      "a viewer adding a connection",
      decide("connection", "create", ws("viewer")),
      { allowed: false, code: "forbidden", reason: "Only an editor or admin of this workspace can change its connections." },
    ],
    [
      "an editor deleting someone else's shared sign-in",
      decide("connection", "delete", conn("editor", "signInShared")),
      { allowed: false, code: "forbidden", reason: "Only whoever signed in to this connection, or an admin, can change it." },
    ],
    [
      "an editor renaming a connection someone else added, that requires sign-in",
      decide("connection", "update", conn("editor", "signInEach", { signedIn: true })),
      { allowed: false, code: "forbidden", reason: "Only whoever added this connection, or an admin, can change it." },
    ],
    [
      "an editor signing in to someone else's shared sign-in",
      decide("connection", "signIn", conn("editor", "signInShared")),
      { allowed: false, code: "forbidden", reason: "Only whoever signed in to this connection, or an admin, can sign in to it again." },
    ],
    [
      "a viewer changing a key",
      decide("connection", "update", conn("viewer", "key")),
      { allowed: false, code: "forbidden", reason: "Only an editor or admin of this workspace can change its connections." },
    ],
    [
      "someone outside the workspace",
      decide("connection", "use", conn(null, "signInEach")),
      { allowed: false, code: "not_found", reason: "This connection doesn't exist or was deleted." },
    ],
  ])("%s", (_name, actual, expected) => {
    expect(actual).toEqual(expected);
  });
});
