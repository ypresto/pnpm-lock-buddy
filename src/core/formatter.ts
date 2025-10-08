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
      dependencyPath?: string;
    }>;
  }>;
}

function getTypeShortCode(type: string, isOptional = false): string {
  const baseTypeMapping: Record<string, string> = {
    dependencies: "",
    devDependencies: "dev",
    optionalDependencies: "optional",
    peerDependencies: "peer",
    transitive: "transitive",
    file: "file:",
  };

  if (isOptional && type !== "optionalDependencies") {
    const baseCode = baseTypeMapping[type] || "";
    const parts = [baseCode, "optional"].filter(Boolean);
    return parts.join(",");
  }

  return baseTypeMapping[type] || "";
}

/**
 * Ultra-fast path formatting with prefix merging
 * O(n log n) sorting + O(n*m) formatting instead of exponential complexity
 */
/**
 * Extract canonical version identifier for version mapping
 * Handles normalization of link paths and file paths
 */
function extractCanonicalVersion(
  packageId: string,
  packageName: string,
): string {
  if (packageId.includes("@file:")) {
    // For file dependencies, use the package name as canonical identifier
    // since they all point to the same local package
    return `file:${packageName}`;
  } else if (packageId.includes("@link:")) {
    // For link dependencies, normalize to canonical package name
    // Both "link:../bakuraku-fetch" and "link:../../packages/webapp/bakuraku-fetch"
    // should map to the same canonical identifier
    return `link:${packageName}`;
  } else {
    // Handle standard version dependencies like "react@19.1.1"
    const atIndex = packageId.lastIndexOf("@");
    if (atIndex > 0) {
      return packageId.substring(atIndex + 1);
    } else {
      // Fallback - shouldn't happen in normal cases
      return packageId;
    }
  }
}

function formatPathsWithPrefixMerging(
  allPaths: DependencyPathStep[][],
  versionColor: (s: string) => string,
  numberColor: (s: string) => string,
  basePrefix: string,
  compactTreeDepth?: number,
  versionMap?: Map<string, number>,
  targetPackageName?: string,
): string[] {
  const lines: string[] = [];

  // Sort paths by prefix for efficient merging - O(n log n)
  allPaths.sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const aKey = `${a[i]?.package}@${a[i]?.type}`;
      const bKey = `${b[i]?.package}@${b[i]?.type}`;
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
  });

  // Track what we've already displayed to enable merging
  const displayedSegments = new Set<string>();
  // Track which segments are last children (used └─)
  const lastChildSegments = new Set<string>();

  // Process each path - O(n*m) where n=paths, m=avg depth
  for (let pathIndex = 0; pathIndex < allPaths.length; pathIndex++) {
    const currentPath = allPaths[pathIndex];
    if (!currentPath) continue;

    for (let i = 0; i < currentPath.length; i++) {
      const step = currentPath[i];
      if (!step) continue;

      // Create segment key for this position
      const segmentKey = currentPath
        .slice(0, i + 1)
        .map((s) => `${s?.package}@${s?.type}`)
        .join("→");

      // Skip if we've already shown this segment
      if (displayedSegments.has(segmentKey)) {
        continue;
      }
      displayedSegments.add(segmentKey);

      // Apply compact tree logic
      const shouldCompact =
        compactTreeDepth !== undefined && currentPath.length > compactTreeDepth;
      if (shouldCompact && i > 1 && i < currentPath.length - 2) {
        continue; // Skip middle segments in compact mode
      }

      const isLinked = step.specifier?.startsWith("link:");
      const typeCode = isLinked ? "link:" : getTypeShortCode(step.type);

      // Calculate if this is the last occurrence of this depth across all paths
      const isLastAtThisDepth = !allPaths.some(
        (otherPath, otherIndex) =>
          otherIndex > pathIndex &&
          otherPath.length > i &&
          otherPath
            .slice(0, i)
            .every(
              (otherStep, j) =>
                currentPath[j] &&
                otherStep.package === currentPath[j]!.package &&
                otherStep.type === currentPath[j]!.type,
            ),
      );

      // Generate tree connector
      const connector = isLastAtThisDepth ? "└─" : "├─";

      // Track if this is a last child
      if (isLastAtThisDepth) {
        lastChildSegments.add(segmentKey);
      }

      // Build indentation, skipping │ for levels that are last children
      let indentation = "";
      for (let depth = 0; depth < i; depth++) {
        const depthKey = currentPath
          .slice(0, depth + 1)
          .map((s) => `${s?.package}@${s?.type}`)
          .join("→");
        // Only add │ if this ancestor is NOT a last child
        indentation += lastChildSegments.has(depthKey) ? "   " : "│  ";
      }

      const prefix = `${basePrefix}    ${indentation}${connector}`;

      const typeLabel = typeCode ? `(${typeCode})` : "";
      const isLeaf = i === currentPath.length - 1;
      let packageName = isLeaf ? versionColor(step.package) : step.package;

      // Add version number for target - use canonical version extraction
      if (versionMap && isLeaf && targetPackageName) {
        const canonicalVersion = extractCanonicalVersion(
          step.package,
          targetPackageName,
        );
        const versionKey = `${targetPackageName}@${canonicalVersion}`;
        const versionNum = versionMap.get(versionKey);
        if (versionNum) {
          packageName = `${packageName} ${numberColor(`[${versionNum}]`)}`;
        }
      }

      const separator = typeLabel ? "─ " : "── ";
      lines.push(`${prefix}${typeLabel}${separator}${packageName}`);
    }
  }

  return lines;
}

function formatDependencyTree(
  path: DependencyPathStep[],
  versionColor: (s: string) => string,
  _useColor: boolean,
  basePrefix = "",
  allPaths?: DependencyPathStep[][],
  compactTreeDepth?: number,
  versionMap?: Map<string, number>,
  targetPackageName?: string,
): string[] {
  if (path.length === 0) return [];

  const numberColor = _useColor ? chalk.yellow : (s: string) => s;

  // If we have multiple paths, use efficient prefix-based merging
  if (allPaths && allPaths.length > 1) {
    return formatPathsWithPrefixMerging(
      allPaths,
      versionColor,
      numberColor,
      basePrefix,
      compactTreeDepth,
      versionMap,
      targetPackageName,
    );
  } else {
    // Single path logic (keep original fast approach)
    const lines: string[] = [];
    const shouldCompact =
      compactTreeDepth !== undefined && path.length > compactTreeDepth;

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      if (!step) continue;

      if (shouldCompact && i > 1 && i < path.length - 2) {
        if (i === 2) {
          lines.push(`${basePrefix}    │  ...`);
        }
        continue;
      }

      const isLinked = step.specifier?.startsWith("link:");
      const typeCode = isLinked ? "link:" : getTypeShortCode(step.type);

      let prefix = "";
      if (i === 0) {
        prefix =
          i === path.length - 1 ? `${basePrefix}    └─` : `${basePrefix}    ├─`;
      } else {
        const isLast = i === path.length - 1;
        const parentSpacing = `${basePrefix}    ` + "│  ".repeat(i);
        prefix = isLast ? `${parentSpacing}└─` : `${parentSpacing}├─`;
      }

      const typeLabel = typeCode ? `(${typeCode})` : "";
      const isLeaf = i === path.length - 1;
      let packageName = isLeaf ? versionColor(step.package) : step.package;

      // Add version number for target - use canonical version extraction
      if (versionMap && isLeaf && targetPackageName) {
        const canonicalVersion = extractCanonicalVersion(
          step.package,
          targetPackageName,
        );
        const versionKey = `${targetPackageName}@${canonicalVersion}`;
        const versionNum = versionMap.get(versionKey);
        if (versionNum) {
          packageName = `${packageName} ${numberColor(`[${versionNum}]`)}`;
        }
      }

      const separator = typeLabel ? "─ " : "── ";
      lines.push(`${prefix}${typeLabel}${separator}${packageName}`);
    }

    return lines;
  }
}

export function formatDuplicates(
  duplicates: DuplicateInstance[],
  useColor = true,
  showDependencyTree = false,
  compactTreeDepth?: number,
): string {
  if (duplicates.length === 0) {
    return "No duplicate packages found.";
  }

  const lines: string[] = [];
  const versionMap = new Map<string, number>();

  // Build version mapping using canonical version extraction
  // Reset counter for each package so numbering is per-package
  for (const dup of duplicates) {
    let versionCounter = 1;
    for (const instance of dup.instances) {
      // Use canonical version extraction to handle different relative paths
      const canonicalVersion = extractCanonicalVersion(
        instance.id,
        dup.packageName,
      );
      const versionKey = `${dup.packageName}@${canonicalVersion}`;

      if (!versionMap.has(versionKey)) {
        versionMap.set(versionKey, versionCounter++);
      }
    }
  }

  // Color functions
  const packageColor = useColor ? chalk.cyan : (s: string) => s;
  const versionColor = useColor ? chalk.green : (s: string) => s;
  const countColor = useColor ? chalk.red : (s: string) => s;
  const numberColor = useColor ? chalk.yellow : (s: string) => s;

  for (const dup of duplicates) {
    lines.push(
      `\n${packageColor(dup.packageName)} has ${countColor(String(dup.instances.length))} instances:`,
    );

    for (const instance of dup.instances) {
      if (showDependencyTree && instance.dependencyInfo) {
        for (const project of instance.projects) {
          lines.push(`  ${project}:`);
          lines.push(
            ...formatDependencyTree(
              instance.dependencyInfo.path,
              versionColor,
              useColor,
              "  ",
              instance.dependencyInfo.allPaths,
              compactTreeDepth,
              versionMap,
              dup.packageName,
            ),
          );
        }
      } else {
        const typeInfo = instance.dependencyType
          ? ` (${instance.dependencyType})`
          : "";

        // Use canonical version extraction for consistency
        const canonicalVersion = extractCanonicalVersion(
          instance.id,
          dup.packageName,
        );
        const versionKey = `${dup.packageName}@${canonicalVersion}`;
        const versionNum = versionMap.get(versionKey);
        const displayVersion = `${versionColor(instance.id)} ${numberColor(`[${versionNum}]`)}`;

        lines.push(`  ${displayVersion}${typeInfo}`);

        if (instance.projects.length > 0) {
          lines.push(`    Used by: ${instance.projects.join(", ")}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Clean up file variant project key for better readability
 */
function cleanFileVariantProjectKey(projectKey: string): string {
  if (projectKey.includes("@file:")) {
    // Extract just the file path and peer deps part
    // @layerone/foundation-react@file:packages/webapp/foundation-react(peer-deps)
    // -> packages/webapp/foundation-react(peer-deps)
    const fileMatch = projectKey.match(/@file:(.+)/);
    if (fileMatch && fileMatch[1]) {
      return fileMatch[1];
    }
  }
  return projectKey;
}

export function formatPerProjectDuplicates(
  perProjectDuplicates: PerProjectDuplicate[],
  useColor = true,
  showDependencyTree = false,
  compactTreeDepth?: number,
): string {
  if (perProjectDuplicates.length === 0) {
    return "No per-project duplicate packages found.";
  }

  const lines: string[] = [];
  const versionMap = new Map<string, number>();

  // Build version mapping using canonical version extraction
  // Reset counter for each package so numbering is per-package
  for (const project of perProjectDuplicates) {
    for (const pkg of project.duplicatePackages) {
      let versionCounter = 1;
      for (const instance of pkg.instances) {
        // Use canonical version extraction to handle different relative paths
        const canonicalVersion = extractCanonicalVersion(
          instance.id,
          pkg.packageName,
        );
        const versionKey = `${pkg.packageName}@${canonicalVersion}`;

        if (!versionMap.has(versionKey)) {
          versionMap.set(versionKey, versionCounter++);
        }
      }
    }
  }

  // Color functions
  const packageColor = useColor ? chalk.cyan : (s: string) => s;
  const projectColor = useColor ? chalk.blue : (s: string) => s;
  const versionColor = useColor ? chalk.green : (s: string) => s;
  const countColor = useColor ? chalk.red : (s: string) => s;
  const numberColor = useColor ? chalk.yellow : (s: string) => s;

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

  // Format each package group
  for (const [packageName, importerGroups] of packageGroups.entries()) {
    lines.push(`\n${packageColor(packageName)}:`);

    // Sort importer groups by cleaned name for better organization
    const sortedImporterGroups = importerGroups.sort((a, b) => {
      const cleanA = cleanFileVariantProjectKey(a.importer);
      const cleanB = cleanFileVariantProjectKey(b.importer);
      return cleanA.localeCompare(cleanB);
    });

    for (const group of sortedImporterGroups) {
      const instanceCount = group.instances.length;
      const cleanImporterName = cleanFileVariantProjectKey(group.importer);
      lines.push(
        `  ${projectColor(cleanImporterName)}: has ${countColor(String(instanceCount))} instance${instanceCount > 1 ? "s" : ""}`,
      );

      for (let i = 0; i < group.instances.length; i++) {
        const instance = group.instances[i];
        const isLast = i === group.instances.length - 1;

        if (showDependencyTree && instance.dependencyInfo) {
          const { path } = instance.dependencyInfo;

          const hasRealPath =
            path.length > 1 ||
            (path.length === 1 && path[0].type !== "transitive");

          if (hasRealPath) {
            lines.push(
              ...formatDependencyTree(
                path,
                versionColor,
                useColor,
                "",
                instance.dependencyInfo.allPaths,
                compactTreeDepth,
                versionMap,
                packageName,
              ),
            );
          } else {
            // For instances without proper dependency paths, create a minimal tree structure
            const canonicalVersion = extractCanonicalVersion(
              instance.id,
              packageName,
            );
            const versionKey = `${packageName}@${canonicalVersion}`;
            const versionNum = versionMap.get(versionKey);
            const displayVersion = `${versionColor(instance.id)} ${numberColor(`[${versionNum}]`)}`;

            // Use tree formatting even for simple instances
            const treePrefix = isLast ? "    └───" : "    ├───";
            lines.push(`${treePrefix} ${displayVersion}`);
          }
        } else {
          // Use canonical version extraction for consistency and add tree formatting
          const canonicalVersion = extractCanonicalVersion(
            instance.id,
            packageName,
          );
          const versionKey = `${packageName}@${canonicalVersion}`;
          const versionNum = versionMap.get(versionKey);
          const displayVersion = `${versionColor(instance.id)} ${numberColor(`[${versionNum}]`)}`;

          // Always use tree formatting in per-project mode
          const treePrefix = isLast ? "    └───" : "    ├───";
          lines.push(`${treePrefix} ${displayVersion}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// Re-export other required functions that were in the original file
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

export function formatAsJson(results: FormattedResult[]): string {
  return JSON.stringify(results, null, 2);
}

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

export function formatAsTree(
  results: FormattedResult[],
  useColor = true,
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  const grouped = groupByPackage(results);

  const packageColor = useColor ? chalk.cyan : (s: string) => s;
  const versionColor = useColor ? chalk.green : (s: string) => s;
  const specifierColor = useColor ? chalk.yellow : (s: string) => s;

  for (const [packageName, packageResults] of Object.entries(grouped)) {
    lines.push(`${packageName}`);

    for (const result of packageResults) {
      const packageId = result.version
        ? `${result.packageName}@${result.version}`
        : result.packageName;

      lines.push(`  ${versionColor(packageId)}`);
      lines.push(`    => ${packageColor(result.path.join(" > "))}`);

      if (result.specifier) {
        lines.push(`       specifier: ${specifierColor(result.specifier)}`);
      }
    }
  }

  return lines.join("\n");
}
