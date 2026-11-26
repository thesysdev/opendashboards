"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { trackUpgradeClicked } from "@/lib/analytics-client";
import { cn } from "@/lib/utils";

import { BevelButton } from "../bevel-button";
import { PLANS, type Plan } from "./plans";

export type Billing = "annual" | "monthly";

/**
 * The four plans side by side (two by two on tablets, stacked on phones),
 * under a switch between annual and monthly prices. Team is picked out as
 * the plan most teams start on.
 */
export function PlanCards() {
  const [billing, setBilling] = useState<Billing>("annual");

  return (
    <div className="flex flex-col items-center gap-8">
      <BillingSwitch value={billing} onChange={setBilling} />
      <ul className="grid w-full gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <li key={plan.id} className="flex">
            <PlanCard plan={plan} billing={billing} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two options in a pill, the chosen one raised. A radio group, so arrow keys move between them. */
export function BillingSwitch({ value, onChange }: { value: Billing; onChange: (value: Billing) => void }) {
  const options: { value: Billing; label: string; note?: string }[] = [
    { value: "annual", label: "Annual", note: "Save 20%" },
    { value: "monthly", label: "Monthly" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Billing"
      className="inline-flex rounded-full border border-black/8 bg-[#f7f7f8] p-1 font-(family-name:--font-display) text-[15px] font-medium"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault();
                const next = option.value === "annual" ? "monthly" : "annual";
                onChange(next);
                const sibling = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                  `[data-value="${next}"]`,
                );
                sibling?.focus();
              }
            }}
            data-value={option.value}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950",
              checked
                ? "bg-white text-neutral-950 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.04)]"
                : "text-neutral-950/60 hover:text-neutral-950",
            )}
          >
            {option.label}
            {option.note && (
              <span className="rounded-full bg-[#049156]/10 px-2 py-0.5 text-xs font-medium text-[#03784a]">
                {option.note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const price = billing === "annual" ? plan.annual : plan.monthly;
  const free = plan.monthly === 0;
  const per =
    price === null ? "Priced with you" : free ? "Free forever" : plan.unit === "editor" ? "per editor / month" : "per month";

  return (
    <article
      aria-labelledby={`plan-${plan.id}`}
      className={cn(
        "relative flex w-full flex-col rounded-2xl border bg-white p-6",
        plan.featured ? "border-neutral-950 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.25)]" : "border-black/8",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={`plan-${plan.id}`} className="font-(family-name:--font-display) text-lg leading-7 font-semibold">
          {plan.name}
        </h3>
        {plan.featured && (
          <span className="rounded-full bg-neutral-950 px-2.5 py-0.5 text-xs leading-5 font-medium text-white">
            Most popular
          </span>
        )}
      </div>
      <p className="mt-1.5 min-h-[3em] lg:min-h-[4.5em] text-[15px] leading-normal text-pretty text-neutral-950/60">{plan.tagline}</p>

      {/* The price, then what it's for, on its own line so the four cards line up in a
          row whatever the widths. The switch above says how it's billed. */}
      <p className="mt-6 font-(family-name:--font-display) text-[2.5rem] leading-none font-semibold tracking-[-0.02em]">
        {price === null ? "Custom" : `$${price}`}
      </p>
      <p className="mt-2 text-sm leading-5 whitespace-nowrap text-neutral-950/60">{per}</p>

      {/* A paid plan's button counts as an upgrade click; Free's is a sign-up. */}
      <div
        className="mt-6 [&>*]:w-full"
        onClickCapture={
          free ? undefined : () => trackUpgradeClicked({ fromPlan: null, toPlan: plan.id, interval: billing, source: "pricing", orgId: null })
        }
      >
        <BevelButton
          href={plan.cta.href}
          label={plan.cta.label}
          variant={plan.featured ? "primary" : "secondary"}
          external={plan.cta.external}
          arrow={false}
        />
      </div>

      <p className="mt-6 border-t border-black/6 pt-6 text-sm leading-5 font-medium text-neutral-950/60">
        {plan.includes ? `Everything in ${plan.includes}, plus:` : "Includes:"}
      </p>
      <ul className="mt-3 flex flex-col gap-3 text-[15px] leading-5">
        {plan.highlights.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <Check aria-hidden className="mt-px size-4 shrink-0 text-[#049156]" strokeWidth={2.5} />
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}
