import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { loadLockfile, clearLockfileCache } from "../../../src/core/lockfile";
import { DependencyTracker } from "../../../src/core/dependency-tracker";

// pnpm v11+ writes an "env" document (configDependencies /
// packageManagerDependencies) ahead of the project document when config
// dependencies or a pinned pnpm version are present, producing a
// multi-document YAML file separated by `---`.
// See: https://pnpm.io/lockfile
const fixturePath = path.join(
  __dirname,
  "../../fixtures/multi-document-lockfile.yaml",
);

const trailingSeparatorFixturePath = path.join(
  __dirname,
  "../../fixtures/multi-document-lockfile-trailing-separator.yaml",
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

  it("ignores a trailing empty document produced by a trailing `---` separator", () => {
    // js-yaml's loadAll() yields a trailing `null` document when the file
    // ends with a bare `---` separator. That must not shadow the real
    // project document that precedes it.
    const result = loadLockfile(trailingSeparatorFixturePath);

    expect(result.importers["."]).toBeDefined();
    expect(result.packages?.["express@4.18.2"]).toBeDefined();
  });
});

describe("DependencyTracker with a multi-document pnpm v11+ lockfile", () => {
  // There is no node_modules next to this fixture, so DependencyTracker must
  // take its lockfile-only fallback path (see hasRealVirtualStore) — this
  // exercises loadLockfile's multi-document handling end to end through the
  // same code path a real `pnpm-lock-buddy` invocation would use.
  it("resolves importers for a package declared in the project document", async () => {
    const tracker = new DependencyTracker(fixturePath);

    const isUsed = await tracker.isPackageUsed("express@4.18.2");
    expect(isUsed).toBe(true);

    const importers = await tracker.getImportersForPackage("express@4.18.2");
    expect(importers).toContain(".");
  });
});
