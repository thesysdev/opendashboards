import { ArrowUpRight, Check, Cloud, Server, ShieldCheck, type LucideIcon } from "lucide-react";

import { BevelButton } from "../bevel-button";
import { LINKS } from "../links";
import { SectionHeader } from "../section-header";

const WAYS: {
  id: string;
  Icon: LucideIcon;
  name: string;
  line: string;
  points: string[];
  cta: { label: string; href: string; external?: boolean };
  primary?: boolean;
}[] = [
  {
    id: "self-host",
    Icon: Server,
    name: "Self-host",
    line: "The open-source app, on your servers.",
    points: ["Built on the OpenUI Dashboards API", "Any model, or bring your own key", "Credentials stay on your servers"],
    cta: { label: "Deploy", href: LINKS.github, external: true },
    primary: true,
  },
  {
    id: "private",
    Icon: ShieldCheck,
    name: "Private deployment",
    line: "Everything inside your network.",
    points: ["OpenUI Cloud inside your network", "Complete isolation for your data", "Set up with our team"],
    cta: { label: "Talk to sales", href: LINKS.sales, external: true },
  },
  {
    id: "cloud",
    Icon: Cloud,
    name: "Cloud",
    line: "Hosted by us at opendashboards.com.",
    points: ["Nothing to install", "Sign up and connect your tools", "Dashboards and chats saved for you"],
    cta: { label: "Try for free", href: LINKS.app },
  },
];

/**
 * "Three ways to use it", on a grey band: columns split by hairlines (rows
 * below 900px), no cards, each ending in its button. A line for builders
 * under them points at the Thesys console for an API key.
 */
export function Ways() {
  return (
    <section
      aria-labelledby="ways-title"
      className="mt-[clamp(7rem,13.4vw,12rem)] bg-neutral-100 py-[clamp(4rem,7vw,6.5rem)] text-neutral-950 [--gutter:1rem] md:[--gutter:1.5rem] lg:[--gutter:2rem]"
    >
      <SectionHeader
        id="ways-title"
        title="Three ways to use it."
        subtitle="Run it yourself, keep it fully private, or let us host it."
      />

      <div className="mx-auto mt-[clamp(3rem,5vw,4.5rem)] grid max-w-140 grid-cols-1 px-(--gutter) min-[56.25rem]:max-w-300 min-[56.25rem]:grid-cols-3">
        {WAYS.map(({ id, Icon, name, line, points, cta, primary }) => (
          <article
            key={id}
            aria-labelledby={`way-${id}`}
            className="flex min-w-0 flex-col border-black/6 max-[56.25rem]:py-8 max-[56.25rem]:not-first:border-t max-[56.25rem]:first:pt-0 min-[56.25rem]:px-[clamp(20px,3vw,40px)] min-[56.25rem]:py-1 min-[56.25rem]:not-first:border-l"
          >
            <div className="flex flex-col gap-1.5">
              <span className="mb-2.5 grid size-9 place-items-center rounded-[10px] border border-black/6 bg-white">
                <Icon aria-hidden className="size-4.5" strokeWidth={1.75} />
              </span>
              <h3
                id={`way-${id}`}
                className="font-(family-name:--font-display) text-[22px] leading-[1.2] font-semibold tracking-[-0.02em]"
              >
                {name}
              </h3>
              <p className="text-[15px] leading-normal text-pretty text-neutral-950/60">{line}</p>
            </div>
            <ul className="mt-5 mb-7 grid gap-2.5 text-[15px] leading-[1.4]">
              {points.map((point) => (
                <li key={point} className="flex items-center gap-2.5 text-pretty">
                  <Check aria-hidden className="size-3.5 shrink-0 text-neutral-950/60" strokeWidth={2} />
                  {point}
                </li>
              ))}
            </ul>
            {/* Pinned to the bottom so the three buttons line up. */}
            <div className="mt-auto">
              <BevelButton
                href={cta.href}
                label={cta.label}
                variant={primary ? "primary" : "secondary"}
                external={cta.external}
                arrow
              />
            </div>
          </article>
        ))}
      </div>

      <p className="mx-auto mt-[clamp(2.5rem,4vw,3.5rem)] max-w-300 px-(--gutter) text-center text-[15px] leading-normal text-pretty text-neutral-950/60">
        Building your own product? Embed the OpenUI Dashboards API.{" "}
        <a
          href={LINKS.console}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-baseline gap-[0.2em] rounded-[3px] text-neutral-950 transition-opacity duration-160 hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current motion-reduce:transition-none"
        >
          Get API
          <ArrowUpRight aria-hidden className="relative top-[0.08em] size-[0.8em] shrink-0" strokeWidth={2.5} />
        </a>
      </p>
    </section>
  );
}
