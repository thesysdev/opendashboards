"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";

import { BillingSwitch } from "@/components/landing/pricing/plan-cards";
import { PLANS } from "@/components/landing/pricing/plans";
import { Button } from "@/components/ui/button";
import { intervalLabel, trackUpgradeClicked, type UpgradeSource } from "@/lib/analytics-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Interval = "month" | "year";

/**
 * The paid plans to choose from, as on the pricing page: price, what it's
 * for and what it adds, with annual or monthly billing. Choosing one goes on
 * to Stripe Checkout; how many seats on Team is asked there.
 */
export function PlanPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  planIds,
  pending,
  onChoose,
  source,
  fromPlan,
  orgId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** The plans on offer, by id: those in config with a price. */
  planIds: string[];
  /** The plan being bought, while Checkout opens. */
  pending: string | null;
  onChoose: (planId: string, interval: Interval) => void;
  /** Where it was opened from, the plan the workspace is on, and the workspace (null: a new one), for analytics. */
  source: UpgradeSource;
  fromPlan: string | null;
  orgId: string | null;
}) {
  const [interval, setInterval] = useState<Interval>("year");
  const plans = PLANS.filter((plan) => planIds.includes(plan.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex justify-center">
          <BillingSwitch
            value={interval === "year" ? "annual" : "monthly"}
            onChange={(billing) => setInterval(billing === "annual" ? "year" : "month")}
          />
        </div>

        <ul className={cn("grid gap-3", plans.length > 1 && "sm:grid-cols-2")}>
          {plans.map((plan) => {
            const price = interval === "year" ? plan.annual : plan.monthly;
            return (
              <li key={plan.id} className={cn("flex flex-col rounded-xl border p-4", plan.featured && "border-foreground")}>
                <p className="font-semibold">{plan.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{plan.tagline}</p>
                <p className="mt-4 text-3xl font-semibold tracking-tight">${price}</p>
                <p className="text-sm text-muted-foreground">
                  {plan.unit === "editor" ? "per editor / month" : "per month"}
                  {interval === "year" ? ", billed annually" : ""}
                </p>
                <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-[#049156]" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  variant={plan.featured ? "default" : "outline"}
                  disabled={pending !== null}
                  onClick={() => {
                    trackUpgradeClicked({ fromPlan, toPlan: plan.id, interval: intervalLabel(interval), source, orgId });
                    onChoose(plan.id, interval);
                  }}
                >
                  {pending === plan.id && <Loader2Icon className="animate-spin" />}
                  {plan.cta.label}
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
