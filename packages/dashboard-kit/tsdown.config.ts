import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // Peers and runtime deps stay external: the consumer's React, react-lang and zod.
  external: [/^react/, /^@openuidev\//, /^zod/, /^recharts/],
});
