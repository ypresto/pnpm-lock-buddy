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
    hoistedAs: string;
  }>;
}

export interface HoistedVersionInfo {
  version: string;
  hoistedAs: string; // The name it's hoisted as (e.g., "strip-ansi" or "strip-ansi-cjs")
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

export function getHoistedVersions(
  modulesYaml: ModulesYaml,
): Map<string, HoistedVersionInfo[]> {
  const result = new Map<string, HoistedVersionInfo[]>();

  if (!modulesYaml.hoistedDependencies) {
    return result;
  }

  for (const [packageSpec, hoistInfo] of Object.entries(
    modulesYaml.hoistedDependencies,
  )) {
    try {
      const parsed = parsePackageString(packageSpec);
      const packageName = parsed.name;
      const version = parsed.version || "unknown";

      // Get the hoisted name (the key in the hoistInfo object)
      const hoistedAs = Object.keys(hoistInfo)[0] || packageName;

      if (!result.has(packageName)) {
        result.set(packageName, []);
      }

      result.get(packageName)!.push({
        version,
        hoistedAs,
      });
    } catch {
      // Skip packages that can't be parsed
    }
  }

  return result;
}

export function detectHoistConflicts(
  modulesYaml: ModulesYaml,
  packageFilter?: string[],
): HoistConflict[] {
  if (!modulesYaml.hoistedDependencies) {
    return [];
  }

  // Group hoisted packages by base package name and hoisted name
  const packageVersions = new Map<
    string,
    Array<{ spec: string; hoistedAs: string }>
  >();

  for (const [packageSpec, hoistInfo] of Object.entries(
    modulesYaml.hoistedDependencies,
  )) {
    try {
      const parsed = parsePackageString(packageSpec);
      const packageName = parsed.name;
      const hoistedAs = Object.keys(hoistInfo)[0] || packageName;

      // Apply package filter if specified
      if (packageFilter && packageFilter.length > 0) {
        const matches = packageFilter.some((filter) => {
          if (filter.includes("*")) {
            const regex = new RegExp("^" + filter.replace(/\*/g, ".*") + "$");
            return regex.test(packageName);
          }
          return packageName === filter;
        });
        if (!matches) continue;
      }

      if (!packageVersions.has(packageName)) {
        packageVersions.set(packageName, []);
      }
      packageVersions.get(packageName)!.push({ spec: packageSpec, hoistedAs });
    } catch (error) {
      // Skip packages that can't be parsed
      continue;
    }
  }

  // Find packages with multiple versions hoisted to the SAME name
  const conflicts: HoistConflict[] = [];

  for (const [packageName, entries] of packageVersions.entries()) {
    // Group by hoisted name
    const byHoistedName = new Map<
      string,
      Array<{ spec: string; hoistedAs: string }>
    >();
    for (const entry of entries) {
      if (!byHoistedName.has(entry.hoistedAs)) {
        byHoistedName.set(entry.hoistedAs, []);
      }
      byHoistedName.get(entry.hoistedAs)!.push(entry);
    }

    // Only flag as conflict if multiple versions map to the same hoisted name
    for (const [hoistedAs, specs] of byHoistedName.entries()) {
      if (specs.length > 1) {
        const versions = specs.map((entry) => {
          const parsed = parsePackageString(entry.spec);
          return {
            version: parsed.version || "unknown",
            fullSpec: entry.spec,
            hoistedAs,
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
  }

  // Sort conflicts by package name
  conflicts.sort((a, b) => a.packageName.localeCompare(b.packageName));

  return conflicts;
}
