import { depPathToFilename } from "@pnpm/dependency-path";

/**
 * Detect hash suffix in a store path filename.
 * pnpm v10 uses 32-char hex hashes, pnpm v9 uses 26-char base32 hashes.
 * Returns the match object with index pointing to the underscore before the hash.
 */
function detectHashSuffix(
  storePath: string,
): { index: number; hash: string } | null {
  // Match _<hash> at end: 32 hex chars (v10) or 26 base32 chars (v9)
  const match = storePath.match(/_([a-z0-9]{26}|[0-9a-f]{32})$/);
  if (!match) return null;
  return { index: match.index!, hash: match[1]! };
}

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

  // Try exact match with depPathToFilename (works when hash algorithm matches)
  const hashInfo = detectHashSuffix(rawStorePath);
  if (hashInfo) {
    const maxLength = rawStorePath.length;
    for (const candidate of versionMatches) {
      if (depPathToFilename(candidate, maxLength) === rawStorePath) {
        return candidate;
      }
    }

    // Hash algorithm mismatch (e.g. pnpm v9 base32 vs v10 hex) -
    // compare the non-hash prefix which is deterministic regardless of hash algorithm
    const storePrefix = rawStorePath.substring(0, hashInfo.index);
    for (const candidate of versionMatches) {
      const candidateFilename = depPathToFilename(candidate, 10000);
      if (candidateFilename.startsWith(storePrefix)) {
        return candidate;
      }
    }
  } else {
    // No hash suffix - direct comparison with non-truncated filename
    for (const candidate of versionMatches) {
      if (depPathToFilename(candidate, 10000) === rawStorePath) {
        return candidate;
      }
    }
  }

  return versionMatches[0]!;
}
