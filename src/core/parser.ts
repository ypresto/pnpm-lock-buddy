export interface ParsedPackage {
  name: string;
  version: string | null;
  scope: string | null;
  dependencies: Record<string, string>;
}

/**
 * Parse a package string into its components
 * @param packageString - Package string like "name@version(dep@version)"
 * @returns Parsed package object
 */
export function parsePackageString(packageString: string): ParsedPackage {
  if (!packageString || typeof packageString !== "string") {
    throw new Error(`Invalid package string: ${packageString}`);
  }

  const result: ParsedPackage = {
    name: "",
    version: null,
    scope: null,
    dependencies: {},
  };

  // Extract dependencies first (they're in parentheses)
  let mainPart = packageString;
  const depMatches = packageString.match(/\(([^)]+)\)/g);

  if (depMatches) {
    // Remove dependencies from main part
    mainPart = packageString.substring(0, packageString.indexOf("("));

    // Parse each dependency
    depMatches.forEach((match) => {
      const depString = match.slice(1, -1); // Remove parentheses
      const atIndex = depString.lastIndexOf("@");

      if (atIndex > 0) {
        const depName = depString.substring(0, atIndex);
        const depVersion = depString.substring(atIndex + 1);
        result.dependencies[depName] = depVersion;
      }
    });
  }

  // Parse main package name and version
  const atIndex = mainPart.lastIndexOf("@");

  if (atIndex > 0) {
    // Has version
    result.name = mainPart.substring(0, atIndex);
    result.version = mainPart.substring(atIndex + 1);
  } else if (atIndex === 0) {
    // Scoped package without version
    result.name = mainPart;
  } else {
    // Regular package without version
    result.name = mainPart;
  }

  // Add safety check for result.name
  if (!result.name) {
    throw new Error(`Failed to parse package name from: ${packageString}`);
  }

  // Extract scope if present
  if (result.name.startsWith("@")) {
    const scopeEnd = result.name.indexOf("/");
    if (scopeEnd > 0) {
      result.scope = result.name.substring(0, scopeEnd);
    }
  }

  return result;
}
