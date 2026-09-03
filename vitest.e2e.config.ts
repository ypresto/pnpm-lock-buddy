import { defineConfig } from "vitest/config";

// Real end-to-end tests: real `pnpm install`s against real pnpm v11/v12
// CLIs. Needs network access and is much slower than the default suite, so
// it's kept out of `pnpm test` and run explicitly via `pnpm test:e2e`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
