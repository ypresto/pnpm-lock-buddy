import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // test/e2e drives real `pnpm install`s against real pnpm CLIs (network
    // access, much slower); it's excluded here and run separately via
    // `pnpm test:e2e` (see vitest.e2e.config.ts).
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "test/", "old/", "dist/"],
    },
  },
});
