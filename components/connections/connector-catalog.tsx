"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { ANY_MCP_SERVER, CATALOG_CATEGORIES, POPULAR, searchCatalog, type CatalogEntry } from "@/lib/sources/directory";

import { ConnectDialog } from "./add-connection-button";
import type { SecretMode } from "./connection-form-dialog";
import { SourceTile } from "./source-tile";

/**
 * Every source and known MCP server, by what people build dashboards about.
 * Picking one opens its connect dialog. `sampleData` is a tile that adds the
 * sample dataset, for someone who has connections but hasn't added it.
 */
export function ConnectorCatalog({ secretMode, sampleData }: { secretMode: SecretMode; sampleData?: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [open, setOpen] = useState(false);
  const searching = query.trim().length > 0;
  const results = searching ? searchCatalog(query) : [];

  function pick(entry: CatalogEntry) {
    setSelected(entry);
    setOpen(true);
  }

  return (
    <>
      <div className="relative mb-6">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connectors"
          aria-label="Search connectors"
          className="pl-9"
        />
      </div>

      {searching ? (
        results.length > 0 ? (
          <Group label={`${results.length} ${results.length === 1 ? "result" : "results"}`} entries={results} onPick={pick} />
        ) : (
          <p className="mb-6 text-sm text-muted-foreground">
            Nothing called &ldquo;{query.trim()}&rdquo; yet. If it has a remote MCP server, connect it below.
          </p>
        )
      ) : (
        <>
          {sampleData && (
            <section className="mb-7">
              <h3 className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Try it out</h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2.5">
                <li>{sampleData}</li>
              </ul>
            </section>
          )}
          <Group label="Popular" entries={POPULAR} onPick={pick} />
          {CATALOG_CATEGORIES.map((category) => (
            <Group key={category.key} label={category.label} entries={category.entries} onPick={pick} />
          ))}
        </>
      )}

      <button
        type="button"
        onClick={() => pick(ANY_MCP_SERVER)}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3.5 text-left transition-colors hover:bg-neutral-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <SourceTile label={ANY_MCP_SERVER.tile} className="size-9" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Any MCP server</span>
          <span className="block text-sm text-muted-foreground">Connect another remote server by its URL, with a sign-in or an API key.</span>
        </span>
      </button>

      {selected && (
        <ConnectDialog
          key={selected.key}
          source={selected.open.kind === "source" ? selected.open.source : { type: "mcp", flavor: null }}
          service={selected.open.kind === "mcp" ? selected.open.service : undefined}
          open={open}
          onOpenChange={setOpen}
          secretMode={secretMode}
        />
      )}
    </>
  );
}

function Group({ label, entries, onPick }: { label: string; entries: CatalogEntry[]; onPick: (entry: CatalogEntry) => void }) {
  return (
    <section className="mb-7">
      <h3 className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
      {/* Fixed-width cards: a short row stays short instead of stretching. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2.5">
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={() => onPick(entry)}
              className="flex h-full w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-neutral-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <SourceTile label={entry.tile} className="size-9" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{entry.label}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{entry.blurb}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
