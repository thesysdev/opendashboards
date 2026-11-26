import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { siGithub } from "simple-icons";

import { LINKS } from "./links";

/** The site's pages, in the top bar's nav. */
const NAV = [{ label: "Pricing", href: "/pricing" }];

/** Pricing and the GitHub star: quiet text buttons, so Try for free stands out. */
const NAV_LINK =
  "inline-flex h-10 items-center gap-1.5 rounded-full whitespace-nowrap px-3 text-[15px] font-medium text-[#0a0a0a] transition-colors hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-neutral-950";

/**
 * The marketing pages' top bar: Shiro and the product name on the left; Pricing,
 * the GitHub star and the Try for free primary button on the right. Below 768px
 * Pricing and the star move into a menu.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-white px-4">
      <div className="relative mx-auto flex min-h-16 max-w-390 items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          {/* Shiro is OpenUI's mascot: it grows on hover and goes to OpenUI. */}
          <a
            href={LINKS.openui}
            aria-label="OpenUI"
            className="block shrink-0 rounded-full transition-[scale] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.18] focus-visible:scale-[1.18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
          >
            <Image src="/shiro-logo.svg" alt="" width={32} height={32} className="size-8 object-contain" />
          </a>
          <Link
            href="/"
            className="rounded-sm font-(family-name:--font-geist) text-[15px] leading-6 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 max-[22.5rem]:hidden"
          >
            OpenDashboards
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label="Main" className="flex items-center gap-2 max-md:hidden">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={NAV_LINK}>
                {item.label}
              </Link>
            ))}
            <StarButton />
          </nav>
          {/* The app is behind sign-in: there's nothing to prefetch. */}
          <Link
            href={LINKS.app}
            prefetch={false}
            className="inline-flex h-10 items-center rounded-full whitespace-nowrap border border-white/14 bg-[#0a0a0a] px-3.5 text-[15px] font-medium text-white shadow-[inset_0_7px_12px_-6px_rgb(255_255_255/0.16),inset_0_-5px_8px_-2px_rgb(0_0_0/0.6)] focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-neutral-950"
          >
            Try for free
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * Below 768px: a round button that opens the nav and GitHub in a card under
 * the top bar. A <details>, so it works without JavaScript; a new page renders
 * a new header, so it starts closed after following a link.
 */
function MobileMenu() {
  return (
    <details className="group relative md:hidden">
      <summary
        aria-label="Menu"
        className="grid size-10 cursor-pointer list-none place-items-center rounded-full border border-black/8 bg-[#f7f7f8] text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-neutral-950 [&::-webkit-details-marker]:hidden"
      >
        <Menu aria-hidden className="size-[18px] group-open:hidden" strokeWidth={2} />
        <X aria-hidden className="hidden size-[18px] group-open:block" strokeWidth={2} />
      </summary>
      <nav
        aria-label="Main"
        className="absolute top-[calc(100%+0.75rem)] right-0 flex w-56 flex-col rounded-2xl border border-black/8 bg-white p-2 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.2)]"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-[10px] px-3 py-2.5 font-(family-name:--font-display) text-[15px] text-neutral-950 hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-neutral-950"
          >
            {item.label}
          </Link>
        ))}
        <a
          href={LINKS.github}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-[10px] px-3 py-2.5 font-(family-name:--font-display) text-[15px] text-neutral-950 hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-neutral-950"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4 fill-current">
            <path d={siGithub.path} />
          </svg>
          Star on GitHub
        </a>
      </nav>
    </details>
  );
}

/** The GitHub mark and "Star", styled like the nav's links. */
function StarButton() {
  return (
    <a
      href={LINKS.github}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Star OpenDashboards on GitHub"
      className={NAV_LINK}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-[18px] shrink-0 fill-current"
      >
        <path d={siGithub.path} />
      </svg>
      Star
    </a>
  );
}
