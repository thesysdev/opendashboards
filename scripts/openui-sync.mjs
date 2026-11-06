// Runs Prism against a local build of the OpenUI dashboard packages, for
// developing upstream changes (e.g. value formatting) with Prism's dashboards.
//
//   pnpm openui:sync            build react-components + dashboard-library in
//                               the OpenUI worktree, pack them, and install the
//                               tarballs here (via pnpm.overrides)
//   pnpm openui:sync --no-build pack and install without rebuilding
//   pnpm openui:sync --unlink   drop the overrides and go back to npm
//
// The worktree defaults to ../openui-prism (override with OPENUI_DIR).
//
// Why tarballs and not `link:`: each package in the OpenUI workspace has its
// own node_modules/react, so a link loads React twice and hooks break. Packing
// also rewrites workspace:/catalog: versions into real ranges. Installed from
// a tarball, the packages resolve React and friends from Prism.
//
// The overrides point at a folder outside this repo, so they only work on this
// machine: don't commit them. `--unlink` before committing.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const OPENUI_PNPM = "pnpm@10.33.0";
const PACKAGES = [
  { name: "@openuidev/react-components", dir: "packages/react-components" },
  { name: "@openuidev/dashboard-library", dir: "packages/libraries/dashboard" },
];

const args = new Set(process.argv.slice(2));
const prismDir = process.cwd();
const openuiDir = resolve(process.env.OPENUI_DIR ?? "../openui-prism");
const packsDir = resolve(openuiDir, ".prism-packs");
const pkgPath = resolve(prismDir, "package.json");

const run = (cmd, cmdArgs, cwd) => execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
const readPkg = () => JSON.parse(readFileSync(pkgPath, "utf8"));
const writePkg = (pkg) => writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (args.has("--unlink")) {
  const pkg = readPkg();
  for (const { name } of PACKAGES) delete pkg.pnpm?.overrides?.[name];
  if (pkg.pnpm?.overrides && !Object.keys(pkg.pnpm.overrides).length) delete pkg.pnpm.overrides;
  if (pkg.pnpm && !Object.keys(pkg.pnpm).length) delete pkg.pnpm;
  writePkg(pkg);
  run("pnpm", ["install"], prismDir);
  console.log("Back on the npm versions of the OpenUI packages.");
  process.exit(0);
}

if (!args.has("--no-build")) {
  run("npx", ["-y", OPENUI_PNPM, "--filter", "@openuidev/dashboard-library...", "--workspace-concurrency=1", "run", "build"], openuiDir);
}

rmSync(packsDir, { recursive: true, force: true });
mkdirSync(packsDir, { recursive: true });
for (const { dir } of PACKAGES) {
  run("npx", ["-y", OPENUI_PNPM, "pack", "--pack-destination", packsDir], resolve(openuiDir, dir));
}

const tarballs = readdirSync(packsDir);
const pkg = readPkg();
pkg.pnpm ??= {};
pkg.pnpm.overrides ??= {};
for (const { name } of PACKAGES) {
  const file = tarballs.find((f) => f.startsWith(`${name.replace("@", "").replace("/", "-")}-`));
  if (!file) throw new Error(`No tarball for ${name} in ${packsDir}`);
  pkg.pnpm.overrides[name] = `file:${relative(prismDir, resolve(packsDir, file))}`;
}
writePkg(pkg);

// --force: the tarball path stays the same between syncs, so make pnpm re-read it.
run("pnpm", ["install", "--force"], prismDir);
console.log(`Prism now uses the OpenUI packages built in ${openuiDir}. Restart the dev server to pick them up.`);
