import { depPathToFilename } from "@pnpm/dependency-path";

/**
 * Find the lockfile snapshot key that corresponds to a store path.
 *
 * @param packageName - Package name, e.g. "next-navigation-guard"
 * @param storePath - Store path extracted from .pnpm directory (with + decoded to /)
 * @param candidates - All snapshot keys for this package name
 * @returns The matching lockfile key, or the first candidate as fallback
 */
export function resolveStorePathToLockfileKey(
  packageName: string,
  storePath: string,
  candidates: string[],
): string | null {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  // Extract version from store path: pkg@version_...
  const versionMatch = storePath.match(
    new RegExp(
      `^${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@([^_]+)`,
    ),
  );
  const version = versionMatch?.[1];

  if (!version) {
    return candidates[0]!;
  }

  // Filter by version
  const versionPrefix = `${packageName}@${version}`;
  const versionMatches = candidates.filter(
    (k) => k === versionPrefix || k.startsWith(versionPrefix + "("),
  );

  if (versionMatches.length <= 1) {
    return versionMatches[0] ?? candidates[0]!;
  }

  // Multiple candidates with same version - use deterministic filename matching
  // Re-encode store path back to + format for comparison with depPathToFilename output
  const rawStorePath = storePath.replace(/\//g, "+");

  // Determine maxLength from the store path itself
  // If store path has a hash suffix, maxLength = storePath.length
  // If no hash suffix, use a large number (no truncation needed)
  const hashMatch = rawStorePath.match(/_[0-9a-f]{32}$/);
  const maxLength = hashMatch ? rawStorePath.length : 10000;

  for (const candidate of versionMatches) {
    if (depPathToFilename(candidate, maxLength) === rawStorePath) {
      return candidate;
    }
  }

  // Fallback: try matching without hash (for pnpm v9 base32 hashes or other formats)
  // Compare the non-hash prefix of the store path
  if (hashMatch) {
    const storePrefix = rawStorePath.substring(0, hashMatch.index!);
    for (const candidate of versionMatches) {
      const candidateFilename = depPathToFilename(candidate, 10000);
      if (candidateFilename.startsWith(storePrefix)) {
        return candidate;
      }
    }
  }

  return versionMatches[0]!;
}
