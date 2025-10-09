import { readFileSync } from "fs";
import { load } from "js-yaml";
import { parsePackageString } from "./parser.js";

export interface ModulesYaml {
  hoistPattern?: string[];
  hoistedDependencies?: Record<string, Record<string, string>>;
  included?: Record<string, string>;
  layoutVersion?: number;
  nodeLinker?: string;
  packageManager?: string;
  pendingBuilds?: string[];
  prunedAt?: string;
  publicHoistPattern?: string[];
  registries?: Record<string, string>;
  skipped?: string[];
  storeDir?: string;
  virtualStoreDir?: string;
}

export interface HoistConflict {
  packageName: string;
  versions: Array<{
    version: string;
    fullSpec: string;
  }>;
}

export function loadModulesYaml(modulesYamlPath: string): ModulesYaml {
  try {
    const content = readFileSync(modulesYamlPath, "utf-8");
    const parsed = load(content) as ModulesYaml;
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to load ${modulesYamlPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function detectHoistConflicts(
  modulesYaml: ModulesYaml,
  packageFilter?: string[],
): HoistConflict[] {
  if (!modulesYaml.hoistedDependencies) {
    return [];
  }

  // Group hoisted packages by base package name
  const packageVersions = new Map<string, Set<string>>();

  for (const [packageSpec] of Object.entries(
    modulesYaml.hoistedDependencies,
  )) {
    try {
      const parsed = parsePackageString(packageSpec);
      const packageName = parsed.name;

      // Apply package filter if specified
      if (packageFilter && packageFilter.length > 0) {
        const matches = packageFilter.some((filter) => {
          if (filter.includes("*")) {
            const regex = new RegExp(
              "^" + filter.replace(/\*/g, ".*") + "$",
            );
            return regex.test(packageName);
          }
          return packageName === filter;
        });
        if (!matches) continue;
      }

      if (!packageVersions.has(packageName)) {
        packageVersions.set(packageName, new Set());
      }
      packageVersions.get(packageName)!.add(packageSpec);
    } catch (error) {
      // Skip packages that can't be parsed
      continue;
    }
  }

  // Find packages with multiple versions
  const conflicts: HoistConflict[] = [];

  for (const [packageName, specs] of packageVersions.entries()) {
    if (specs.size > 1) {
      const versions = Array.from(specs).map((spec) => {
        const parsed = parsePackageString(spec);
        return {
          version: parsed.version || "unknown",
          fullSpec: spec,
        };
      });

      // Sort by version for consistent output
      versions.sort((a, b) => a.version.localeCompare(b.version));

      conflicts.push({
        packageName,
        versions,
      });
    }
  }

  // Sort conflicts by package name
  conflicts.sort((a, b) => a.packageName.localeCompare(b.packageName));

  return conflicts;
}
