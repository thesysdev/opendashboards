// Writes the dashboard kit's library spec for the server (OpenUI Cloud
// generates dashboards against it). The kit's components are client modules,
// so the server can't build the spec at runtime: it's generated here from the
// built package, before `dev` and `build`. Regenerated, never edited.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

execFileSync("pnpm", ["--filter", "@prism/dashboard-kit", "build"], { stdio: "ignore" });
const { library } = await import(`../packages/dashboard-kit/dist/index.mjs?t=${Date.now()}`);

mkdirSync("lib/dashboards/generated", { recursive: true });
writeFileSync("lib/dashboards/generated/kit.spec.json", `${JSON.stringify(library.toSpec(), null, 2)}\n`);
console.log("Wrote lib/dashboards/generated/kit.spec.json");
