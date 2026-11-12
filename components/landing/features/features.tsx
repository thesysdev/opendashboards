import Image from "next/image";
import type { ReactNode } from "react";

import { ConversationalArt, EditWidgetArt, HoverArt, LiveArt } from "./feature-art";

const FEATURES: { title: string; description: string; art: ReactNode }[] = [
  {
    title: "Conversational",
    description: "Ask what you need to know. Get a dashboard built for that question.",
    art: <ConversationalArt />,
  },
  { title: "Interactive by default", description: "Pick a filter and every widget updates.", art: <HoverArt /> },
  { title: "Live updates", description: "New data, same dashboard. No regeneration.", art: <LiveArt /> },
  {
    title: "Targeted edits",
    description: "Change one chart. Only that chart is generated again.",
    art: <EditWidgetArt />,
  },
];

/**
 * "Your data, your models, your servers": a centred statement, then four
 * cards two by two (one column on phones), each a scene on the hero's light
 * dither stage with a title and a line under it.
 */
export function Features() {
  return (
    <section
      aria-labelledby="features-title"
      className="pt-[clamp(7rem,13.4vw,12rem)] text-neutral-950 [--gutter:1rem] md:[--gutter:1.5rem] lg:[--gutter:2rem]"
    >
      <div className="mx-auto w-full max-w-[calc(75rem+2*var(--gutter))] px-(--gutter)">
        <h2
          id="features-title"
          className="mx-auto max-w-208 text-center font-(family-name:--font-display) text-2xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance md:text-[32px]"
        >
          Your data, your models,
          <br className="md:hidden" /> your servers
        </h2>
        <p className="mx-auto mt-4 max-w-144 text-center text-base leading-normal text-pretty text-neutral-950/60 md:text-[17px]">
          Run OpenDashboards on your own infrastructure, with any model through the OpenUI Dashboards API.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-10 md:mt-16 md:grid-cols-2 md:gap-x-4 md:gap-y-12 min-[56.25rem]:gap-x-6 min-[56.25rem]:gap-y-16">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="min-w-0">
              <div className="relative aspect-[358/260] w-full overflow-hidden rounded-xl border border-[#f8f8f8] [container-type:inline-size] md:aspect-[588/360] md:rounded-3xl">
                {/* Stills of the hero's dither shader, served as they are. */}
                <Image src="/landing/shaders/faded-dither-light-compact.webp" alt="" fill unoptimized className="object-cover md:hidden" />
                <Image src="/landing/shaders/faded-dither-light-wide.webp" alt="" fill unoptimized className="object-cover max-md:hidden" />
                <div className="relative z-1 grid size-full place-items-center">{feature.art}</div>
              </div>
              <h3 className="mt-5 font-(family-name:--font-display) text-base leading-[1.3] md:text-[22px] md:font-medium md:tracking-[-0.2px]">
                {feature.title}
              </h3>
              <p className="mt-2 max-w-[44ch] text-base leading-normal text-pretty text-neutral-950/60 md:text-[15px]">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
