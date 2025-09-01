import semver from "semver";

/**
 * Parse a version specifier into its components (handling OR operators)
 * @param specifier - Version specifier like "^1.0.0" or "^7.0.0 || ^8.0.1"
 * @returns Array of version range components
 */
export function parseVersionSpecifier(specifier: string): string[] {
  if (!specifier || typeof specifier !== "string") {
    return [];
  }

  // Split by OR operator and clean up whitespace
  return specifier
    .split("||")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Check if a version matches a version specifier
 * @param version - The version to check (e.g., "8.5.6")
 * @param specifier - The version specifier (e.g., "^8.0.0" or "^7.0.0 || ^8.0.1")
 * @param exactMatch - If true, only exact version matches are allowed
 * @returns True if the version matches the specifier
 */
export function matchesVersion(
  version: string | null | undefined,
  specifier: string | null | undefined,
  exactMatch = false,
): boolean {
  // Handle invalid inputs
  if (
    !version ||
    !specifier ||
    typeof version !== "string" ||
    typeof specifier !== "string"
  ) {
    return false;
  }

  // If exact match is required, use simple string comparison for each part
  if (exactMatch) {
    const parts = parseVersionSpecifier(specifier);
    return parts.some((part) => part === version);
  }

  // Parse the specifier into parts
  const parts = parseVersionSpecifier(specifier);

  // Check if any part matches
  for (const part of parts) {
    try {
      // Use semver to check if the version satisfies the specifier part
      if (semver.satisfies(version, part)) {
        return true;
      }
    } catch (error) {
      // If semver can't parse, fall back to exact string comparison
      if (part === version) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a version specifier is valid
 * @param specifier - The version specifier to validate
 * @returns True if the specifier is valid
 */
export function isValidVersionSpecifier(specifier: string): boolean {
  if (!specifier || typeof specifier !== "string") {
    return false;
  }

  const parts = parseVersionSpecifier(specifier);

  // Check each part
  return parts.every((part) => {
    try {
      // Try to create a range with the part
      return semver.validRange(part) !== null;
    } catch {
      return false;
    }
  });
}
