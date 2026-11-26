"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { upgradeAction } from "@/app/(app)/settings/billing-actions";
import { paidPlansAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import type { UpgradeSource } from "@/lib/analytics-client";

import { PlanPickerDialog } from "./plan-picker";

/*
 * Upgrading a workspace, from anywhere: the Billing section, or wherever the
 * plan refuses something. Self-contained: it loads the plans on offer, and
 * choosing one goes straight to Stripe Checkout. Only admins can pay; for
 * anyone else the server says so and the dialog shows it.
 */

/** The plan picker for one workspace, open while `open` is. `reason` is why they're seeing it, e.g. the refusal. */
export function UpgradeDialog({
  orgId,
  open,
  onOpenChange,
  reason,
  source,
  fromPlan,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
  /** Where it was opened from, and the plan the workspace is on, for analytics. */
  source: UpgradeSource;
  fromPlan: string;
}) {
  const [planIds, setPlanIds] = useState<string[] | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (open && planIds === null) void paidPlansAction().then((plans) => setPlanIds(plans.map((plan) => plan.id)));
  }, [open, planIds]);

  function choose(planId: string, interval: "month" | "year") {
    setChoosing(planId);
    startTransition(async () => {
      const result = await upgradeAction({ orgId, planId, interval });
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      setChoosing(null);
      toast.error(result.message);
    });
  }

  return (
    <PlanPickerDialog
      open={open && planIds !== null && planIds.length > 0}
      onOpenChange={onOpenChange}
      title="Upgrade"
      description={reason}
      planIds={planIds ?? []}
      pending={choosing}
      onChoose={choose}
      source={source}
      fromPlan={fromPlan}
      orgId={orgId}
    />
  );
}

/** A button that opens the upgrade dialog. */
export function UpgradeButton({
  orgId,
  reason,
  size = "sm",
  label = "Upgrade",
  source,
  fromPlan,
}: {
  orgId: string;
  reason?: string;
  source: UpgradeSource;
  fromPlan: string;
  size?: "sm" | "default";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <UpgradeDialog orgId={orgId} open={open} onOpenChange={setOpen} reason={reason} source={source} fromPlan={fromPlan} />
    </>
  );
}
