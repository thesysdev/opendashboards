import { Check, X } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

const ROWS = [
  { label: "Your data", without: "Goes through Anthropic", with: "Can stay in your network" },
  { label: "Models", without: "Claude only", with: "Any model" },
  { label: "Hosting", without: "Anthropic’s cloud", with: "Your servers or ours" },
  { label: "Speed", without: "Baseline", with: "Up to 10× faster" },
];

/* A hairline under a table row that fades out before the table's edges. */
const ROW_LINE =
  "bg-[linear-gradient(90deg,transparent,rgb(0_0_0/0.06)_10%,rgb(0_0_0/0.06)_90%,transparent)] bg-size-[100%_1px] bg-bottom bg-no-repeat";

/** A red cross or a green tick: one shape for both sides, only the colour differs. */
function Verdict({ pass }: { pass: boolean }) {
  const Icon = pass ? Check : X;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5.5 shrink-0 place-items-center rounded-[7px] text-white",
        pass ? "bg-[#049156]" : "bg-[#b91c1c]",
      )}
    >
      <Icon className="size-[13px]" strokeWidth={2.75} />
    </span>
  );
}

/**
 * "Why not Claude Dashboards?": the question and its answer on the left, a
 * table on the right (under it below 1200px). Phones get the table grouped
 * by column instead, all of Claude Dashboards first, then all of ours.
 */
export function Compare() {
  return (
    <section
      aria-labelledby="compare-title"
      className="pt-[clamp(7rem,13.4vw,12rem)] text-neutral-950 [--gutter:1rem] md:[--gutter:1.5rem] lg:[--gutter:2rem]"
    >
      <div className="mx-auto grid max-w-[calc(75rem+2*var(--gutter))] items-start gap-10 px-(--gutter) min-[75rem]:grid-cols-[minmax(0,360px)_minmax(0,1fr)] min-[75rem]:gap-20">
        <div className="max-w-xl min-[75rem]:max-w-none">
          <h2
            id="compare-title"
            className="font-(family-name:--font-display) text-2xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance md:max-w-[20ch] md:text-[clamp(1.875rem,4vw,2.5rem)]"
          >
            Why not Claude Dashboards?
          </h2>
          <p className="mt-5 max-w-136 text-base leading-normal text-pretty text-neutral-950/60 md:text-[17px]">
            It only works inside Claude, and it isn’t built for your team.
          </p>
        </div>

        {/* 900px and up: a table, the losing column first. */}
        <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-2xl border border-black/6 text-left font-(family-name:--font-display) text-[15px] leading-[1.4] max-[56.25rem]:hidden">
          <caption className="sr-only">OpenDashboards compared with Claude Dashboards</caption>
          <colgroup>
            <col className="w-[30%]" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className={ROW_LINE}>
              <th scope="col" className="border-r border-black/6 px-4.5 py-4">
                <span className="sr-only">Capability</span>
              </th>
              <th scope="col" className="border-r border-black/6 px-4.5 py-4 text-center font-medium whitespace-nowrap">
                <span className="inline-flex w-[13.5em] items-center gap-2 text-left">Claude Dashboards</span>
              </th>
              <th scope="col" className="px-4.5 py-4 text-center font-medium whitespace-nowrap">
                <span className="inline-flex w-[13.5em] items-center gap-2 text-left">
                  <Image src="/shiro-logo.svg" alt="" width={32} height={32} className="size-8 object-contain" />
                  OpenDashboards
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className={cn(ROW_LINE, "last:bg-none")}>
                <th scope="row" className="border-r border-black/6 px-4.5 py-4 font-medium whitespace-nowrap">
                  {row.label}
                </th>
                <td className="border-r border-black/6 px-4.5 py-4 text-center whitespace-nowrap text-neutral-950/60">
                  <span className="inline-flex w-[13.5em] items-center gap-2 text-left">
                    <Verdict pass={false} />
                    {row.without}
                  </span>
                </td>
                <td className="px-4.5 py-4 text-center whitespace-nowrap text-neutral-950/60">
                  <span className="inline-flex w-[13.5em] items-center gap-2 text-left">
                    <Verdict pass />
                    {row.with}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Phones: grouped by column. */}
        <div className="grid gap-8 min-[56.25rem]:hidden">
          {[
            { name: "Claude Dashboards", pass: false, key: "without" as const },
            { name: "OpenDashboards", pass: true, key: "with" as const },
          ].map((group) => (
            <div key={group.name}>
              <h3 className="mb-1 flex items-center gap-2.5 text-[15px] leading-normal font-medium">
                {group.pass && <Image src="/shiro-logo.svg" alt="" width={20} height={20} className="size-5 object-contain" />}
                {group.name}
              </h3>
              <dl>
                {ROWS.map((row, i) => (
                  <div
                    key={row.label}
                    className={cn(
                      "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 py-3",
                      i > 0 &&
                        "bg-[linear-gradient(to_right,transparent,rgb(0_0_0/0.09)_18%,rgb(0_0_0/0.09)_82%,transparent)] bg-size-[100%_1px] bg-top bg-no-repeat",
                    )}
                  >
                    <dt className="relative text-[13px] leading-normal text-neutral-950/60 after:absolute after:top-1/2 after:-right-2 after:h-[1.5em] after:-translate-y-1/2 after:border-l after:border-black/9">
                      {row.label}
                    </dt>
                    <dd className="flex items-center gap-2">
                      <Verdict pass={group.pass} />
                      {row[group.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
