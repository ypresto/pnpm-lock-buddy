import { depPathToFilename } from "@pnpm/dependency-path";
import crypto from "crypto";

// RFC 4648 base32 alphabet
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Base32 encode a Buffer (RFC 4648), lowercase, no padding.
 */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f]!;
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]!;
  }
  return result.toLowerCase();
}

/**
 * Compute pnpm v9 base32 hash: base32(md5(input)), 26 chars.
 */
function createBase32Hash(input: string): string {
  const hash = crypto.createHash("md5").update(input).digest();
  return base32Encode(hash);
}

/**
 * Compute pnpm v10 hex hash: sha256(input).hex().substring(0, 32).
 */
function createHexHash(input: string): string {
  return crypto
    .createHash("sha256")
    .update(input)
    .digest("hex")
    .substring(0, 32);
}

/**
 * Convert a lockfile dep path to the intermediate filename before truncation/hashing.
 * This is the same logic used by both pnpm v9 and v10.
 */
function depPathToIntermediateFilename(depPath: string): string {
  // Replace special filesystem chars with +
  let filename = depPath.replace(/[\\/:*?"<>|#]/g, "+");
  // Replace parentheses with underscores
  if (filename.includes("(")) {
    filename = filename.replace(/\)$/, "").replace(/\)\(|\(|\)/g, "_");
  }
  return filename;
}

/**
 * Compute the store path filename for a given dep path, using the specified hash format.
 */
function computeStoreFilename(
  depPath: string,
  maxLength: number,
  hashFormat: "hex" | "base32",
): string {
  const filename = depPathToIntermediateFilename(depPath);

  const hashLen = hashFormat === "hex" ? 33 : 27; // _<hash>
  const needsHash =
    filename.length > maxLength ||
    (filename !== filename.toLowerCase() && !filename.startsWith("file+"));

  if (needsHash) {
    const hash =
      hashFormat === "hex"
        ? createHexHash(filename)
        : createBase32Hash(filename);
    return `${filename.substring(0, maxLength - hashLen)}_${hash}`;
  }

  return filename;
}

/**
 * Detect hash suffix format in a store path filename.
 * pnpm v10 uses 32-char hex hashes, pnpm v9 uses 26-char base32 hashes.
 */
function detectHashFormat(
  storePath: string,
): { index: number; format: "hex" | "base32" } | null {
  // Try v10 hex (32 chars, [0-9a-f] only)
  const hexMatch = storePath.match(/_([0-9a-f]{32})$/);
  if (hexMatch) {
    return { index: hexMatch.index!, format: "hex" };
  }
  // Try v9 base32 (26 chars, [a-z2-7] only)
  const base32Match = storePath.match(/_([a-z2-7]{26})$/);
  if (base32Match) {
    return { index: base32Match.index!, format: "base32" };
  }
  return null;
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

  const hashInfo = detectHashFormat(rawStorePath);
  if (hashInfo) {
    // Try exact match using both known hash algorithms
    const maxLength = rawStorePath.length;
    for (const format of ["hex", "base32"] as const) {
      for (const candidate of versionMatches) {
        if (
          computeStoreFilename(candidate, maxLength, format) === rawStorePath
        ) {
          return candidate;
        }
      }
    }

    // Hash computed by a different pnpm minor version that we can't reproduce.
    // Fall back to prefix matching (the part before the hash is deterministic).
    const storePrefix = rawStorePath.substring(0, hashInfo.index);
    const prefixMatches = versionMatches.filter((candidate) => {
      const candidateFilename = depPathToIntermediateFilename(candidate);
      return candidateFilename.startsWith(storePrefix);
    });
    if (prefixMatches.length === 1) {
      return prefixMatches[0]!;
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
