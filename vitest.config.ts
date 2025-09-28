import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "test/", "old/", "dist/"],
    },
  },
  resolve: {
    alias: {
      "@pnpm/reviewing.dependencies-hierarchy/lib/getTree.js": path.resolve(
        __dirname,
        "node_modules/@pnpm/reviewing.dependencies-hierarchy/lib/getTree.js"
      ),
    },
  },
});
