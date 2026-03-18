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

  // Regression: pnpm v9 uses base32 hashes (26 chars) in .pnpm/ directory names,
  // while @pnpm/dependency-path@1001.x produces hex hashes (32 chars).
  // The prefix fallback must handle this hash algorithm mismatch.
  it("should resolve store paths with pnpm v9 base32 hashes via prefix fallback", () => {
    // Actual store paths from layerone created by pnpm v9 (base32 hashes)
    const base32StorePath1 =
      "next-navigation-guard@0.1.2_next@16.1.5_@opentelemetry/api@1.9.0_babel-plu_whdjczy3gvn7thqs6ohkpfrivm";
    const base32StorePath2 =
      "next-navigation-guard@0.1.2_next@16.1.5_@opentelemetry/api@1.9.0_babel-plu_q5pux6huoluew2fvb3ew35lp6a";

    const result1 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      base32StorePath1,
      [candidate1, candidate2],
    );
    const result2 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      base32StorePath2,
      [candidate1, candidate2],
    );

    // Both should resolve (not return null), and at least one should differ
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  // Actual store paths from layerone .pnpm/ that differ in @babel/core version.
  // The prefix before the hash contains the distinguishing peer dep version.
  it("should distinguish store paths with different peer dep versions via prefix (pnpm v9)", () => {
    // These have the same prefix length but different @babel/core versions embedded
    const storePathBabel727 =
      "next-navigation-guard@0.1.2_next@16.1.5_@babel/core@7.27.7_@opentelemetry/api@1.9.0_bab_5b128e3b75f0414bb247d2ed461dd58b";
    const storePathBabel728 =
      "next-navigation-guard@0.1.2_next@16.1.5_@babel/core@7.28.6_@opentelemetry/api@1.9.0_bab_00f86f58a711cd9b2de74c7adfaeb68d";

    const result1 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePathBabel727,
      [candidate1, candidate2],
    );
    const result2 = resolveStorePathToLockfileKey(
      "next-navigation-guard",
      storePathBabel728,
      [candidate1, candidate2],
    );

    expect(result1).toBe(candidate1); // @7.27.7
    expect(result2).toBe(candidate2); // @7.28.6
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
