import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { loadLockfile, clearLockfileCache } from "../../../src/core/lockfile";

// pnpm v11+ writes an "env" document (configDependencies /
// packageManagerDependencies) ahead of the project document when config
// dependencies or a pinned pnpm version are present, producing a
// multi-document YAML file separated by `---`.
// See: https://pnpm.io/lockfile
const fixturePath = path.join(
  __dirname,
  "../../fixtures/multi-document-lockfile.yaml",
);

describe("loadLockfile with multi-document pnpm v11+ lockfile", () => {
  afterEach(() => {
    clearLockfileCache();
  });

  it("reads the project document (last document), not the env document", () => {
    const result = loadLockfile(fixturePath);

    // The env document's `packages`/`snapshots` are empty; only the project
    // document (second document) carries the real dependency graph.
    expect(result.importers["."]).toBeDefined();
    expect(result.packages?.["express@4.18.2"]).toBeDefined();
    expect(result.snapshots?.["express@4.18.2"]).toBeDefined();
  });
});
