"use client";

import { Loader2Icon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { changeSeatsAction, manageBillingAction, type BillingResult } from "@/app/(app)/settings/billing-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UpgradeButton } from "@/components/billing/upgrade";
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
          {subscription && <p className="text-sm text-muted-foreground">{describeSubscription(subscription, plan.perSeat)}</p>}
        </div>
        <div className="flex gap-2">
          {view.canManage && view.hasAccount && <ManageBillingButton orgId={view.orgId} />}
          {view.canManage && subscription && plan.perSeat && <BuySeatsButton orgId={view.orgId} seats={subscription.seats} />}
          {view.canManage && !subscription && view.paidPlans.length > 0 && <UpgradeButton orgId={view.orgId} />}
        </div>
      </div>

      {view.canManage && subscription?.paymentFailed && (
        <p className="border-t bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">Payment failed. Update your card in Manage billing.</p>
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

      {view.canManage && subscription && plan.perSeat && (
        <p className="border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          To move to Standard, cancel your plan and subscribe to Standard once it ends, or email {view.supportEmail}.
        </p>
      )}
    </div>
  );
}

function describeSubscription(subscription: NonNullable<BillingView["subscription"]>, perSeat: boolean): string {
  const seats = perSeat ? `${subscription.seats} ${subscription.seats === 1 ? "seat" : "seats"}, ` : "";
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

/** Where "Add a seat" elsewhere sends an admin: this dialog, open. */
export const BUY_SEATS_HASH = "#buy-seats";

/**
 * Buying more seats on a per-seat plan: how many to add, then Stripe's page,
 * which shows the prorated price before the admin pays.
 */
function BuySeatsButton({ orgId, seats }: { orgId: string; seats: number }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(1);
  const { pending, go } = useStripeRedirect();

  // Opened from an "Add a seat" prompt.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === BUY_SEATS_HASH) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const label = `Buy ${adding} ${adding === 1 ? "seat" : "seats"}`;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Buy seats
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && window.location.hash === BUY_SEATS_HASH) history.replaceState(null, "", window.location.pathname + "#billing");
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Buy additional seats</DialogTitle>
            <DialogDescription>Each seat lets one more person be an admin or editor.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-4 py-2">
            <Button variant="outline" size="icon" aria-label="One fewer" disabled={adding <= 1} onClick={() => setAdding(adding - 1)}>
              <MinusIcon />
            </Button>
            <span className="min-w-16 text-center text-3xl font-semibold tabular-nums">{adding}</span>
            <Button variant="outline" size="icon" aria-label="One more" disabled={seats + adding >= 999} onClick={() => setAdding(adding + 1)}>
              <PlusIcon />
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {seats} seats now, {seats + adding} after. You&apos;ll see the price before you pay.
          </p>
          <DialogFooter>
            <Button disabled={pending} onClick={() => go(() => changeSeatsAction({ orgId, seats: seats + adding }))}>
              {pending && <Loader2Icon className="animate-spin" />}
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
