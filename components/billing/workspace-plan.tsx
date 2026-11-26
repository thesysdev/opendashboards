"use client";

import { PartyPopperIcon, PlugZapIcon, RocketIcon, type LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { UpgradeSource } from "@/lib/analytics-client";
import { workspacePath } from "@/lib/apps/paths";
import type { LimitName } from "@/lib/entitlements/types";
import type { PlanState } from "@/lib/plans/plans";
import { cn } from "@/lib/utils";

import { UpgradeDialog } from "./upgrade";

/*
 * The workspace's plan, for the controls on its pages: whether it's
 * view-only, how much of each limit it uses, and whether the person can pay.
 * It only shapes what's shown. The server checks every change again, so a
 * page that's out of date never lets anything through.
 */

/** The plan as a page sees it. null: billing is off, or they aren't a member here. */
export type WorkspacePlan = (PlanState & { orgId: string; canManageBilling: boolean }) | null;

const PlanContext = createContext<WorkspacePlan>(null);

/** Hands the workspace's plan to its pages. It arrives after the page does; until then everything shows as allowed. */
export function WorkspacePlanProvider({ plan, children }: { plan: Promise<WorkspacePlan>; children: React.ReactNode }) {
  const [value, setValue] = useState<WorkspacePlan>(null);
  useEffect(() => {
    let current = true;
    void plan.then((resolved) => current && setValue(resolved));
    return () => {
      current = false;
    };
  }, [plan]);
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function useWorkspacePlan(): WorkspacePlan {
  return useContext(PlanContext);
}

/** True while the workspace is over its plan: building and adding are paused. */
export function useViewOnly(): boolean {
  return useWorkspacePlan()?.viewOnly ?? false;
}

/** Whether one more of `name` would go over the plan. */
export function useAtLimit(name: LimitName): boolean {
  const plan = useWorkspacePlan();
  const limit = plan?.limits[name];
  return limit !== undefined && limit.max !== null && limit.used >= limit.max;
}

/**
 * A friendly nudge where the plan stops something: what happened, what the
 * next plan adds, and a way there. Admins get the button; everyone else is
 * told to ask an admin.
 */
export function UpgradePrompt({
  icon: Icon = RocketIcon,
  title,
  detail,
  action = "plans",
  source,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  detail?: string;
  /** plans: the pricing modal. team: the same, for Team. seat: Billing's seats field. */
  action?: "plans" | "team" | "seat";
  /** Where it is, for analytics. */
  source: UpgradeSource;
  className?: string;
}) {
  const plan = useWorkspacePlan();
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border bg-background p-3", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-700">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{plan.canManageBilling ? detail : "Ask an admin to pick a plan."}</p>
      </div>
      {plan.canManageBilling &&
        (action === "seat" ? (
          <Button size="sm" asChild>
            <a href={`${workspacePath(plan.orgId, "settings")}#buy-seats`}>Add a seat</a>
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => setOpen(true)}>
              {action === "team" ? "See Team" : "See plans"}
            </Button>
            <UpgradeDialog orgId={plan.orgId} open={open} onOpenChange={setOpen} source={source} fromPlan={plan.planId} />
          </>
        ))}
    </div>
  );
}

const LIMIT_PROMPTS: Partial<Record<LimitName, { icon: LucideIcon; title: (max: number) => string }>> = {
  apps: { icon: PartyPopperIcon, title: (max) => `That's ${max} apps. Nice work.` },
  connections: { icon: PlugZapIcon, title: (max) => `All ${max} connections in use` },
};

/**
 * Where one more app or connection would go over the plan: the nudge, in
 * place of the control. Nothing while there's room, or while the whole
 * workspace is view-only (the banner says it).
 */
export function LimitPrompt({ name, className }: { name: "apps" | "connections"; className?: string }) {
  const plan = useWorkspacePlan();
  const atLimit = useAtLimit(name);
  if (!plan || !atLimit || plan.viewOnly) return null;
  const max = plan.limits[name].max!;
  const next = plan.next[name];
  const prompt = LIMIT_PROMPTS[name]!;
  const detail = !next ? "Delete one to make room." : next.max === null ? `${next.name} has room for more.` : `${next.name} fits ${next.max}.`;
  return <UpgradePrompt icon={prompt.icon} title={prompt.title(max)} detail={detail} source={name} className={className} />;
}

/** At the top of every page of a workspace that's over its plan. */
export function ViewOnlyBanner() {
  const plan = useWorkspacePlan();
  const [open, setOpen] = useState(false);
  if (!plan?.viewOnly) return null;
  return (
    <div data-main-banner className="mx-2 mt-2 flex shrink-0 items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 md:ml-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-violet-700">
        <RocketIcon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-violet-950">Your workspace has outgrown {plan.planName}</p>
        <p className="text-sm text-violet-800">
          {plan.canManageBilling ? "Dashboards still work. Pick a plan to keep building." : "Dashboards still work. Ask an admin to pick a plan."}
        </p>
      </div>
      {plan.canManageBilling && (
        <>
          <Button size="sm" onClick={() => setOpen(true)}>
            See plans
          </Button>
          <UpgradeDialog orgId={plan.orgId} open={open} onOpenChange={setOpen} source="limit_banner" fromPlan={plan.planId} />
        </>
      )}
    </div>
  );
}

