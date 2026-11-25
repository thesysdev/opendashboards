import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

import { COMPARISON, PLANS, type Cell } from "./plans";

/** A tick, a dash, or the value itself. */
function Value({ cell }: { cell: Cell }) {
  if (cell === true) return <Check aria-label="Included" className="mx-auto size-4 text-[#049156]" strokeWidth={2.5} />;
  if (cell === false) return <Minus aria-label="Not included" className="mx-auto size-4 text-neutral-950/25" />;
  return <>{cell}</>;
}

/**
 * Every plan feature by feature, in groups, with Team's column shaded. On
 * narrow screens the table scrolls sideways with the feature names pinned on
 * the left.
 */
export function Comparison() {
  return (
    <section
      aria-labelledby="compare-plans-title"
      className="mx-auto w-full max-w-[calc(75rem+2*var(--gutter))] px-(--gutter) pt-[clamp(5rem,9vw,8rem)] [--gutter:1rem] md:[--gutter:1.5rem] lg:[--gutter:2rem]"
    >
      <h2
        id="compare-plans-title"
        className="font-(family-name:--font-display) text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] font-semibold tracking-[-0.02em] text-balance"
      >
        Compare plans
      </h2>
      <p className="mt-2.5 text-[clamp(1rem,1.3vw,1.125rem)] leading-normal text-pretty text-neutral-950/60">
        Every plan connects to every data source. You pay for the people who build.
      </p>

      <div className="mt-10 -mx-(--gutter) overflow-x-auto px-(--gutter)">
        <table className="w-full min-w-[36rem] md:min-w-[46rem] table-fixed border-separate border-spacing-0 text-left text-[15px] leading-5">
          <caption className="sr-only">Features of each OpenDashboards plan</caption>
          <colgroup>
            <col className="w-38 md:w-[34%]" />
            {PLANS.map((plan) => (
              <col key={plan.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-white py-4 pr-4">
                <span className="sr-only">Feature</span>
              </th>
              {PLANS.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  className="px-3 py-4 text-center font-(family-name:--font-display) text-base font-semibold"
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          {COMPARISON.map((group) => (
            <tbody key={group.title}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={PLANS.length + 1}
                  className="sticky left-0 border-b border-black/8 bg-white pt-8 pb-3 font-(family-name:--font-display) text-sm font-semibold tracking-[-0.01em] text-neutral-950"
                >
                  {group.title}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-black/6 bg-white py-4 pr-4 align-top font-normal"
                  >
                    {row.label}
                    {row.hint && (
                      <span className="mt-1 block text-[13px] leading-[1.45] text-neutral-950/50">{row.hint}</span>
                    )}
                  </th>
                  {PLANS.map((plan) => (
                    <td
                      key={plan.id}
                      className={cn(
                        "border-b border-black/6 px-3 py-4 text-center align-top",
                        plan.featured && "bg-neutral-50",
                      )}
                    >
                      <Value cell={row.values[plan.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
