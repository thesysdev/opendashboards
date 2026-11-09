// Fails the build if anything can reach a model without the chat limits.
// Every model call must go through getGateway() in lib/agent, which requires a
// reserved turn. Runs before `next build`, so it holds without CI.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["app", "components", "config", "lib", "packages", "proxy.ts", "instrumentation.ts"];
const ALLOWED = new Set(["lib/agent/index.ts", "config/common.ts", "config/settings.ts"]);
const SKIP = new Set(["node_modules", "dist", ".next"]);

const FORBIDDEN = [
  { pattern: /\bnew\s+OpenAI\s*\(/, what: "creates a model client" },
  { pattern: /\bgatewayUrl\b/, what: "uses the model gateway URL" },
  { pattern: /api\.thesys\.dev\/v1\/embed/, what: "calls the model gateway directly" },
];

function* sourceFiles(path) {
  if (statSync(path).isFile()) {
    if (/\.(ts|tsx|mts|js|jsx|mjs)$/.test(path)) yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (!SKIP.has(entry)) yield* sourceFiles(join(path, entry));
  }
}

const problems = [];
for (const root of ROOTS) {
  for (const file of sourceFiles(root)) {
    const name = relative(".", file).split(sep).join("/");
    if (ALLOWED.has(name)) continue;
    const text = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(text)) problems.push(`${name} ${what}`);
    }
  }
}

if (problems.length) {
  console.error("Model calls must go through getGateway() in lib/agent, which enforces the chat limits:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
