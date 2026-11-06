import type { Metadata } from "next";

import { KitExample } from "./kit-example";

export const metadata: Metadata = { title: "Dashboard kit" };

/** Development gallery: the dashboard kit's own example, for visual review. */
export default function KitPage() {
  return (
    <div className="flex h-full flex-col">
      <KitExample />
    </div>
  );
}
