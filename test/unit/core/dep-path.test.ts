import { describe, it, expect } from "vitest";
import { depPathToFilename } from "@pnpm/dependency-path";
import { resolveStorePathToLockfileKey } from "../../../src/core/dep-path";

describe("resolveStorePathToLockfileKey", () => {
  // Real snapshot keys from layerone pnpm-lock.yaml before b3b4838 fix commit.
  // These two differ ONLY in the nested @babel/core peer dep version (7.27.7 vs 7.28.6).
  // This caused a dual-instance problem where next-navigation-guard's React Context
  // was instantiated twice, breaking NavigationGuardProvider.
  const candidate1 =
    "next-navigation-guard@0.1.2(next@16.1.5(@babel/core@7.27.7)(@opentelemetry/api@1.9.0)(babel-plugin-react-compiler@1.0.0)(react-dom@19.2.4(react@19.2.4))(react@19.2.4)(sass@1.69.5))(react@19.2.4)";
  const candidate2 =
    "next-navigation-guard@0.1.2(next@16.1.5(@babel/core@7.28.6)(@opentelemetry/api@1.9.0)(babel-plugin-react-compiler@1.0.0)(react-dom@19.2.4(react@19.2.4))(react@19.2.4)(sass@1.69.5))(react@19.2.4)";

  // Store paths as they appear after + → / decoding from .pnpm directory
  const storePath1 = depPathToFilename(candidate1, 120).replace(/\+/g, "/");
  const storePath2 = depPathToFilename(candidate2, 120).replace(/\+/g, "/");

  // Regression: the old findLockfileKey used /@([a-z0-9@/-]+)/gi to extract peers.
  // Since '.' was not in the character class, @babel/core@7.27.7 and @babel/core@7.28.6
  // both extracted as "babel/core@7", producing zero distinguishing peers and always
  // returning the first candidate for both store paths.
  it("should resolve store path to correct lockfile key when nested peer dep versions differ", () => {
    const result1 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePath1,
      [candidate1, candidate2],
    );
    expect(result1).toBe(candidate1);

    const result2 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePath2,
      [candidate1, candidate2],
    );
    expect(result2).toBe(candidate2);
  });

  it("should not map both store paths to the same lockfile key", () => {
    const result1 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePath1,
      [candidate1, candidate2],
    );
    const result2 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePath2,
      [candidate1, candidate2],
    );
    expect(result1).not.toBe(result2);
  });

  it("should return the single candidate when only one exists", () => {
    const result = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePath1,
      [candidate1],
    );
    expect(result).toBe(candidate1);
  });

  it("should return null for empty candidates", () => {
    const result = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePath1,
      [],
    );
    expect(result).toBeNull();
  });

  it("should handle non-truncated store paths", () => {
    const shortCandidate1 = "react-dom@19.2.4(react@19.2.0)";
    const shortCandidate2 = "react-dom@19.2.4(react@19.2.4)";
    const shortStorePath1 = "react-dom@19.2.4_react@19.2.0";
    const shortStorePath2 = "react-dom@19.2.4_react@19.2.4";

    expect(
      resolveStorePathToLockfileKey("react-dom", shortStorePath1, [
        shortCandidate1,
        shortCandidate2,
      ]),
    ).toBe(shortCandidate1);

    expect(
      resolveStorePathToLockfileKey("react-dom", shortStorePath2, [
        shortCandidate1,
        shortCandidate2,
      ]),
    ).toBe(shortCandidate2);
  });

  it("should handle candidates with different versions", () => {
    const v1 = "react@18.2.0";
    const v2 = "react@19.2.4";

    expect(
      resolveStorePathToLockfileKey("react", "react@18.2.0", [v1, v2]),
    ).toBe(v1);

    expect(
      resolveStorePathToLockfileKey("react", "react@19.2.4", [v1, v2]),
    ).toBe(v2);
  });
});
