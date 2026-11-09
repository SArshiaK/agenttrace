import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "cli/index": "src/cli/index.ts", "hook/index": "src/hook/index.ts" },
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: {
      "mcp/index": "src/mcp/index.ts",
      "core/index": "src/core/index.ts",
    },
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
  },
]);
