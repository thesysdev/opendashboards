/**
 * A section's centred title, with a line under it. Shared by the sections
 * that open on a plain heading rather than a statement.
 */
export function SectionHeader({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <header className="mx-auto flex w-full max-w-300 flex-col items-center px-[clamp(1.25rem,4vw,2.5rem)] text-center">
      <h2
        id={id}
        className="max-w-full font-(family-name:--font-display) text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] font-semibold tracking-[-0.02em] text-balance"
      >
        {title}
      </h2>
      <p className="mt-2.5 max-w-224 text-[clamp(1rem,1.3vw,1.125rem)] leading-normal text-pretty text-neutral-950/60">
        {subtitle}
      </p>
    </header>
  );
}
