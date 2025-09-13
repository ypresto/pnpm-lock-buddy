import chalk from "chalk";
import type { DependencyPathStep, DependencyInfo } from "./types.js";

export interface FormattedResult {
  packageName: string;
  version: string | null;
  path: string[];
  type?:
    | "dependency"
    | "devDependency"
    | "peerDependency"
    | "optionalDependency";
  parent?: string;
  specifier?: string;
}

/**
 * Group results by package name
 */
export function groupByPackage(
  results: FormattedResult[],
): Record<string, FormattedResult[]> {
  const grouped: Record<string, FormattedResult[]> = {};

  for (const result of results) {
    const packageName = result.packageName;
    if (!grouped[packageName]) {
      grouped[packageName] = [];
    }
    grouped[packageName]!.push(result);
  }

  return grouped;
}

/**
 * Parse version string to separate base version from peer dependencies
 */
function parseVersionWithPeers(version: string): {
  baseVersion: string;
  peerDeps: string | null;
} {
  const match = version.match(/^([^(]+)(\(.+\))?$/);
  if (match) {
    return {
      baseVersion: match[1] || version,
      peerDeps: match[2] || null,
    };
  }
  return { baseVersion: version, peerDeps: null };
}

/**
 * Format results as a tree structure
 */
export function formatAsTree(
  results: FormattedResult[],
  useColor = true,
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  const grouped = groupByPackage(results);

  // Color functions (disabled if useColor is false)
  const packageColor = useColor ? chalk.cyan : (s: string) => s;
  const versionColor = useColor ? chalk.green : (s: string) => s;
  const specifierColor = useColor ? chalk.yellow : (s: string) => s;
  const peerDepColor = useColor ? chalk.magenta : (s: string) => s;

  for (const [packageName, packageResults] of Object.entries(grouped)) {
    // Group by main section (importers, packages, snapshots)
    const bySection: Record<string, FormattedResult[]> = {};

    for (const result of packageResults) {
      const section = result.path[0];
      if (section && !bySection[section]) {
        bySection[section] = [];
      }
      if (section) {
        bySection[section]!.push(result);
      }
    }

    // Track unique versions for numbering across ALL sections for this package
    const versionTracker = new Map<string, number>();

    // First pass: collect all unique version strings from all sections
    const allVersionStrings = new Set<string>();
    for (const [section, sectionResults] of Object.entries(bySection)) {
      for (const result of sectionResults) {
        if (section === "importers" && result.version) {
          const { peerDeps } = parseVersionWithPeers(result.version);
          if (peerDeps) {
            allVersionStrings.add(result.version);
          }
        } else if (section === "snapshots") {
          const packageId = result.path[1];
          if (packageId) {
            // Extract version from package ID
            let parenDepth = 0;
            let lastValidAtIndex = -1;
            for (let i = 0; i < packageId.length; i++) {
              if (packageId[i] === "(") parenDepth++;
              else if (packageId[i] === ")") parenDepth--;
              else if (packageId[i] === "@" && parenDepth === 0 && i > 0) {
                lastValidAtIndex = i;
              }
            }
            if (lastValidAtIndex !== -1) {
              const versionPart = packageId.substring(lastValidAtIndex + 1);
              const { peerDeps } = parseVersionWithPeers(versionPart);
              if (peerDeps) {
                allVersionStrings.add(versionPart);
              }
            }
          }
        }
      }
    }

    // Assign numbers to unique version strings (only if there are multiple)
    if (allVersionStrings.size > 1) {
      const sortedVersions = Array.from(allVersionStrings).sort();
      sortedVersions.forEach((versionStr, index) => {
        versionTracker.set(versionStr, index + 1);
      });
    }

    // Format each section
    for (const [section, sectionResults] of Object.entries(bySection)) {
      lines.push(`${section}`);

      for (const result of sectionResults) {
        if (section === "packages") {
          // For packages, show the full package ID without numbering
          const packageId = result.path[1];
          lines.push(`  ${packageId}`);
          lines.push(`    => ${packageColor(packageName)}`);
          if (result.specifier) {
            lines.push(`       specifier: ${specifierColor(result.specifier)}`);
          }
          if (result.version) {
            const { baseVersion, peerDeps } = parseVersionWithPeers(
              result.version,
            );
            const formattedVersion = peerDeps
              ? `${versionColor(baseVersion)}${peerDepColor(peerDeps)}`
              : versionColor(result.version);
            lines.push(`       version: ${formattedVersion}`);
          }
        } else if (section === "snapshots") {
          // For snapshots, show with colorization and numbering
          const packageId = result.path[1];
          if (!packageId) continue;

          lines.push(`  ${packageId}`);
          lines.push(`    => ${packageColor(packageName)}`);
          if (result.specifier) {
            lines.push(`       specifier: ${specifierColor(result.specifier)}`);
          }

          // Use result.version if available (for dependencies within snapshots)
          if (result.version) {
            const { baseVersion, peerDeps } = parseVersionWithPeers(
              result.version,
            );

            // Check if we need to add a suffix number
            let versionSuffix = "";
            if (peerDeps && versionTracker.has(result.version)) {
              versionSuffix = ` [${versionTracker.get(result.version)}]`;
            }

            const formattedVersion = peerDeps
              ? `${versionColor(baseVersion)}${peerDepColor(peerDeps)}${versionSuffix}`
              : versionColor(result.version);
            lines.push(`       version: ${formattedVersion}`);
          } else {
            // Fallback: extract version from package ID if result.version is not available
            let versionPart = "";
            let parenDepth = 0;
            let lastValidAtIndex = -1;

            for (let i = 0; i < packageId.length; i++) {
              if (packageId[i] === "(") parenDepth++;
              else if (packageId[i] === ")") parenDepth--;
              else if (packageId[i] === "@" && parenDepth === 0 && i > 0) {
                lastValidAtIndex = i;
              }
            }

            if (lastValidAtIndex !== -1) {
              versionPart = packageId.substring(lastValidAtIndex + 1);
              const { peerDeps } = parseVersionWithPeers(versionPart);

              let versionSuffix = "";
              if (peerDeps && versionTracker.has(versionPart)) {
                versionSuffix = ` [${versionTracker.get(versionPart)}]`;
              }

              // Extract just the version part from packageId
              const { baseVersion: displayVersion, peerDeps: displayPeerDeps } =
                parseVersionWithPeers(versionPart);

              const formattedVersion = displayPeerDeps
                ? `${versionColor(displayVersion)}${peerDepColor(displayPeerDeps)}${versionSuffix}`
                : versionColor(displayVersion);
              lines.push(`       version: ${formattedVersion}`);
            }
          }
        } else if (section === "importers") {
          // For importers, show the importer path and dependency info
          const importerPath = result.path[1];
          const depType = result.path[2];

          lines.push(`  ${importerPath}`);
          lines.push(`    ${depType}`);
          lines.push(`      => ${packageColor(packageName)}`);
          if (result.specifier) {
            lines.push(
              `         specifier: ${specifierColor(result.specifier)}`,
            );
          }
          if (result.version) {
            const { baseVersion, peerDeps } = parseVersionWithPeers(
              result.version,
            );

            // Check if we need to add a suffix number
            let versionSuffix = "";
            if (peerDeps && versionTracker.has(result.version)) {
              versionSuffix = ` [${versionTracker.get(result.version)}]`;
            }

            const formattedVersion = peerDeps
              ? `${versionColor(baseVersion)}${peerDepColor(peerDeps)}${versionSuffix}`
              : versionColor(result.version);
            lines.push(`         version: ${formattedVersion}`);
          }
          if (result.type && result.type !== "dependency") {
            lines.push(`         type: ${result.type}`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format results as JSON
 */
export function formatAsJson(results: FormattedResult[]): string {
  return JSON.stringify(results, null, 2);
}

/**
 * Format results as a simple list
 */
export function formatAsList(results: FormattedResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];

  for (const result of results) {
    const packageId = result.version
      ? `${result.packageName}@${result.version}`
      : result.packageName;

    const pathStr = result.path.join(" > ");

    let line = `${packageId} - ${pathStr}`;

    if (result.specifier) {
      line += ` (specifier: ${result.specifier})`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Format duplicate instances
 */
export interface DuplicateInstance {
  packageName: string;
  instances: Array<{
    id: string;
    version: string;
    dependencies: Record<string, string>;
    projects: string[];
    dependencyType?: string;
    dependencyInfo?: DependencyInfo;
  }>;
}

export interface PerProjectDuplicate {
  importerPath: string;
  duplicatePackages: Array<{
    packageName: string;
    instances: Array<{
      id: string;
      version: string;
      dependencies: Record<string, string>;
      dependencyInfo: DependencyInfo;
      dependencyPath?: string; // Keep for backward compatibility
    }>;
  }>;
}

export function formatDuplicates(
  duplicates: DuplicateInstance[],
  useColor = true,
  showDependencyTree = false,
): string {
  if (duplicates.length === 0) {
    return "No duplicate packages found.";
  }

  const lines: string[] = [];

  // Color functions
  const packageColor = useColor ? chalk.cyan : (s: string) => s;
  const versionColor = useColor ? chalk.green : (s: string) => s;
  const countColor = useColor ? chalk.red : (s: string) => s;

  for (const dup of duplicates) {
    lines.push(
      `\n${packageColor(dup.packageName)} has ${countColor(String(dup.instances.length))} instances:`,
    );

    for (const instance of dup.instances) {
      if (showDependencyTree && instance.dependencyInfo) {
        // Show dependency tree for each project (similar to per-project mode)
        for (const project of instance.projects) {
          lines.push(`  ${project}:`);
          lines.push(
            ...formatDependencyTree(
              instance.dependencyInfo.path,
              versionColor,
              useColor,
              "  ",
            ),
          );
        }
      } else {
        // Traditional format
        const typeInfo = instance.dependencyType
          ? ` (${instance.dependencyType})`
          : "";
        lines.push(`  ${versionColor(instance.id)}${typeInfo}`);

        if (instance.projects.length > 0) {
          lines.push(`    Used by: ${instance.projects.join(", ")}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Convert dependency type to short notation with combination support
 * Examples: od (optional+dependencies), op (optional+peer), oD (optional+dev)
 */
function getTypeShortCode(type: string, isOptional = false): string {
  const baseTypeMapping: Record<string, string> = {
    dependencies: "", // normal dependencies show no indicator
    devDependencies: "dev",
    optionalDependencies: "optional",
    peerDependencies: "peer",
    transitive: "", // transitive also shows no indicator by default
    file: "file:",
  };

  // Handle optional combinations
  if (isOptional && type !== "optionalDependencies") {
    const baseCode = baseTypeMapping[type] || "";
    const parts = [baseCode, "optional"].filter(Boolean);
    return parts.join(",");
  }

  return baseTypeMapping[type] || "";
}

/**
 * Format dependency tree in Option 2 style (Compact Tree with Type Labels)
 * Example:
 *   apps/docissue-webapp
 *   ├─(D)─ some-framework@2.1.0
 *   │  └─(d)─ intermediate-lib@1.5.0
 *   │     └─(d)─ next-navigation-guard@0.1.2(next@15.2.1...)
 */
function formatDependencyTree(
  path: DependencyPathStep[],
  versionColor: (s: string) => string,
  _useColor: boolean,
  basePrefix = "",
): string[] {
  if (path.length === 0) return [];

  const lines: string[] = [];

  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (!step) continue;

    const isLinked = step.specifier.startsWith("link:");
    let typeCode = "";

    if (isLinked) {
      typeCode = "link:";
    } else {
      typeCode = getTypeShortCode(step.type);
    }

    // Determine tree characters based on position with proper depth indentation
    let prefix = "";
    if (i === 0) {
      // First step (after importer)
      prefix =
        i === path.length - 1 ? `${basePrefix}    └─` : `${basePrefix}    ├─`;
    } else {
      // Intermediate steps with increasing indentation
      const isLast = i === path.length - 1;
      const parentSpacing = `${basePrefix}    ` + "│  ".repeat(i);
      prefix = isLast ? `${parentSpacing}└─` : `${parentSpacing}├─`;
    }

    // Only show type label if there's a type code
    const typeLabel = typeCode ? `(${typeCode})` : "";
    // Only colorize the final leaf package (target)
    const isLeaf = i === path.length - 1;
    const packageName = isLeaf ? versionColor(step.package) : step.package;

    const separator = typeLabel ? "─ " : "── ";
    lines.push(`${prefix}${typeLabel}${separator}${packageName}`);
  }

  return lines;
}

/**
 * Format per-project duplicates similar to existing format but grouped by package then importer
 */
export function formatPerProjectDuplicates(
  perProjectDuplicates: PerProjectDuplicate[],
  useColor = true,
  showDependencyTree = false,
): string {
  if (perProjectDuplicates.length === 0) {
    return "No per-project duplicate packages found.";
  }

  const lines: string[] = [];

  // Color functions
  const packageColor = useColor ? chalk.cyan : (s: string) => s;
  const projectColor = useColor ? chalk.blue : (s: string) => s;
  const versionColor = useColor ? chalk.green : (s: string) => s;
  const countColor = useColor ? chalk.red : (s: string) => s;

  // Group by package name first
  const packageGroups = new Map<
    string,
    Array<{ importer: string; instances: any[] }>
  >();

  for (const project of perProjectDuplicates) {
    for (const pkg of project.duplicatePackages) {
      if (!packageGroups.has(pkg.packageName)) {
        packageGroups.set(pkg.packageName, []);
      }
      packageGroups.get(pkg.packageName)!.push({
        importer: project.importerPath,
        instances: pkg.instances,
      });
    }
  }

  // Format each package group (similar to existing format)
  for (const [packageName, importerGroups] of packageGroups.entries()) {
    lines.push(`\n${packageColor(packageName)}:`);

    for (const group of importerGroups) {
      const instanceCount = group.instances.length;
      lines.push(
        `  ${projectColor(group.importer)}: has ${countColor(String(instanceCount))} instance${instanceCount > 1 ? "s" : ""}`,
      );

      for (const instance of group.instances) {
        if (showDependencyTree && instance.dependencyInfo) {
          // Show dependency tree (Option 2 style) only if we have a real path
          const { path } = instance.dependencyInfo;

          // Don't show fake (t) connections - only show real traced paths
          const hasRealPath =
            path.length > 1 ||
            (path.length === 1 && path[0].type !== "transitive");

          if (hasRealPath) {
            lines.push(...formatDependencyTree(path, versionColor, useColor));
          } else {
            lines.push(`    ${versionColor(instance.id)}`);
          }
        } else {
          lines.push(`    ${versionColor(instance.id)}`);
        }
      }
    }
  }

  return lines.join("\n");
}
