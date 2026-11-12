"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { SimpleIcon } from "simple-icons";

/** A connector's logo: its Simple Icons mark, and the colour it's drawn in. */
export type Logo = { icon: SimpleIcon; name: string; color: string };

/* One logo sits in the middle as the hub; the rest orbit it on one ring, evenly spaced and all the same size, starting from twelve o'clock. */
const HUB_SIZE = 50;
const RING_SIZE = 32;
const RING_GAP = 6;
const RING_RADIUS = HUB_SIZE / 2 + RING_SIZE / 2 + RING_GAP;

/* Every few seconds the hub shrinks back into the ring and the next logo grows into the middle, swapping places. Columns start offset by `stagger` so they never swap together. */
const HOLD_MS = 5000;
const STAGGER_MS = 1250;

function slotPosition(slot: number, ringCount: number) {
  if (slot === 0) return { x: 0, y: 0, scale: 1 };
  const angle = -Math.PI / 2 + ((slot - 1) * 2 * Math.PI) / ringCount;
  return {
    x: Math.round(Math.cos(angle) * RING_RADIUS * 100) / 100,
    y: Math.round(Math.sin(angle) * RING_RADIUS * 100) / 100,
    scale: RING_SIZE / HUB_SIZE,
  };
}

/**
 * A card's logos as a hub and a ring. The hub rotates on its own; clicking a
 * ring logo brings it to the middle and restarts the hold. Every bubble is
 * drawn at hub size and scaled down for the ring, so moving between the two
 * is one transform transition.
 */
export function LogoBubbles({ logos, stagger = 0 }: { logos: Logo[]; stagger?: number }) {
  /* slots[i] is where logo i sits: 0 is the hub, 1+ the ring. */
  const [{ slots, hub }, setLayout] = useState(() => ({ slots: logos.map((_, i) => i), hub: 0 }));
  /* Bumped on every click, so the rotation restarts its full hold instead of swapping the picked logo straight back out. */
  const [picks, setPicks] = useState(0);

  const swapInto = (target: number) =>
    setLayout((prev) => {
      if (target === prev.hub) return prev;
      const swapped = [...prev.slots];
      [swapped[prev.hub], swapped[target]] = [prev.slots[target], prev.slots[prev.hub]];
      return { slots: swapped, hub: target };
    });

  useEffect(() => {
    if (logos.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let interval: number | undefined;
    const start = window.setTimeout(
      () => {
        interval = window.setInterval(() => {
          if (document.hidden) return;
          setLayout((prev) => {
            const next = (prev.hub + 1) % prev.slots.length;
            const swapped = [...prev.slots];
            [swapped[prev.hub], swapped[next]] = [prev.slots[next], prev.slots[prev.hub]];
            return { slots: swapped, hub: next };
          });
        }, HOLD_MS);
      },
      picks === 0 ? stagger * STAGGER_MS : 0,
    );

    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [logos.length, stagger, picks]);

  return (
    <div aria-hidden className="relative mb-4 h-31 w-full md:mb-6">
      {logos.map((logo, i) => {
        const { x, y, scale } = slotPosition(slots[i] ?? i, logos.length - 1);
        const isHub = i === hub;
        return (
          <span
            key={logo.name}
            title={logo.name}
            onClick={() => {
              swapInto(i);
              setPicks((n) => n + 1);
            }}
            className={`group absolute top-1/2 left-1/2 -mt-[25px] -ml-[25px] flex size-[50px] rounded-full transition-transform duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${isHub ? "z-1" : "cursor-pointer"}`}
            style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` } as CSSProperties}
          >
            {/* The hover lives on an inner span, so it never fights the swap transform. */}
            <span className="flex rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_14px_-6px_rgb(0_0_0/0.1)] transition-transform duration-150 group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <span className="flex size-[50px] items-center justify-center overflow-hidden rounded-full border border-black/6 bg-white">
                <svg viewBox="0 0 24 24" className="block size-[26px]" style={{ fill: logo.color }}>
                  <path d={logo.icon.path} />
                </svg>
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
