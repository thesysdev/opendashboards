"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { changeSeatsAction, manageBillingAction, upgradeAction, type BillingResult } from "@/app/(app)/settings/billing-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LimitName, Limits } from "@/lib/entitlements/types";
import { cn } from "@/lib/utils";

export type BillingView = {
  orgId: string;
  plan: { id: string; name: string; perSeat: boolean };
  subscription: {
    interval: "month" | "year";
    seats: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    paymentFailed: boolean;
  } | null;
  limits: Limits;
  viewOnly: boolean;
  hasAccount: boolean;
  paidPlans: { id: string; name: string }[];
  supportEmail: string;
  /** An admin: may pay, change or cancel. Everyone else sees the plan and usage. */
  canManage: boolean;
};

const USAGE_LABELS: Record<LimitName, string> = { editors: "Editors", connections: "Connections", apps: "Apps" };

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Sends the browser to the Stripe page an action returns, or says why not. */
function useStripeRedirect() {
  const [pending, startTransition] = useTransition();
  const go = (action: () => Promise<BillingResult>) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) window.location.assign(result.url);
      else toast.error(result.message);
    });
  return { pending, go };
}

/** The workspace's plan and usage; for admins, Upgrade, seats and Manage billing (Stripe's pages). */
export function BillingSection({ view }: { view: BillingView }) {
  const { subscription, plan } = view;
  return (
    <div className="rounded-xl border">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{plan.name} plan</p>
          <p className="text-sm text-muted-foreground">{describeSubscription(view)}</p>
        </div>
        {view.canManage && view.hasAccount && <ManageBillingButton orgId={view.orgId} />}
      </div>

      {view.canManage && subscription?.paymentFailed && (
        <p className="border-t bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">Payment failed. Update your card in Manage billing.</p>
      )}
      {view.viewOnly && (
        <p className="border-t bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          This workspace is over the {plan.name} plan&apos;s limits, so it&apos;s view-only. Delete apps or connections, or upgrade.
        </p>
      )}

      <dl className="grid grid-cols-3 border-t text-sm">
        {(Object.keys(USAGE_LABELS) as LimitName[]).map((name) => {
          const { used, max } = view.limits[name];
          return (
            <div key={name} className="border-r p-3.5 last:border-r-0">
              <dt className="text-muted-foreground">{USAGE_LABELS[name]}</dt>
              <dd className={cn("mt-0.5 font-medium tabular-nums", max !== null && used > max && "text-destructive")}>
                {max === null ? used : `${used} of ${max}`}
              </dd>
            </div>
          );
        })}
      </dl>

      {view.canManage && !subscription && view.paidPlans.length > 0 && <UpgradeForm view={view} />}
      {view.canManage && subscription && plan.perSeat && (
        <SeatsForm orgId={view.orgId} seats={subscription.seats} inUse={view.limits.editors.used} />
      )}
      {view.canManage && subscription && plan.perSeat && (
        <p className="border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          To move to Standard, cancel your plan and subscribe to Standard once it ends, or email {view.supportEmail}.
        </p>
      )}
    </div>
  );
}

function describeSubscription({ subscription, plan }: BillingView): string {
  if (!subscription) return "No card needed. Upgrade for more editors, connections and apps.";
  const seats = plan.perSeat ? `${subscription.seats} ${subscription.seats === 1 ? "seat" : "seats"}, ` : "";
  const cycle = subscription.interval === "year" ? "billed annually" : "billed monthly";
  const end = subscription.currentPeriodEnd ? date(subscription.currentPeriodEnd) : null;
  const when = !end ? "" : subscription.cancelAtPeriodEnd ? `. Cancelled: moves to Free on ${end}` : `. Renews ${end}`;
  return `${seats}${cycle}${when}.`;
}

function ManageBillingButton({ orgId }: { orgId: string }) {
  const { pending, go } = useStripeRedirect();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => go(() => manageBillingAction({ orgId }))}>
      {pending && <Loader2Icon className="animate-spin" />}
      Manage billing
    </Button>
  );
}

/** A free workspace picks a plan and how often to pay, then pays on Stripe Checkout. */
function UpgradeForm({ view }: { view: BillingView }) {
  const [planId, setPlanId] = useState(view.paidPlans[0]!.id);
  const [interval, setInterval] = useState<"year" | "month">("year");
  const { pending, go } = useStripeRedirect();
  const select = "h-8 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";
  return (
    <div className="flex flex-wrap items-center gap-2 border-t p-3.5">
      <select aria-label="Plan" className={select} value={planId} onChange={(event) => setPlanId(event.target.value)}>
        {view.paidPlans.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <select aria-label="Billing period" className={select} value={interval} onChange={(event) => setInterval(event.target.value as "year" | "month")}>
        <option value="year">Billed annually</option>
        <option value="month">Billed monthly</option>
      </select>
      <Button size="sm" disabled={pending} onClick={() => go(() => upgradeAction({ orgId: view.orgId, planId, interval }))}>
        {pending && <Loader2Icon className="animate-spin" />}
        Upgrade
      </Button>
    </div>
  );
}

/** Seats bought on a per-seat plan. Stripe shows the prorated price before the admin confirms. */
function SeatsForm({ orgId, seats, inUse }: { orgId: string; seats: number; inUse: number }) {
  const [value, setValue] = useState(String(seats));
  const { pending, go } = useStripeRedirect();
  const next = Number(value);
  const unchanged = next === seats;
  return (
    <form
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        go(() => changeSeatsAction({ orgId, seats: next }));
      }}
    >
      <label htmlFor="seats" className="text-sm font-medium">
        Seats
      </label>
      <Input
        id="seats"
        type="number"
        inputMode="numeric"
        min={Math.max(inUse, 1)}
        max={999}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 w-20"
      />
      <span className="text-sm text-muted-foreground">{inUse} in use</span>
      <Button type="submit" size="sm" variant="outline" disabled={pending || unchanged || !Number.isInteger(next)}>
        {pending && <Loader2Icon className="animate-spin" />}
        Change seats
      </Button>
    </form>
  );
}
