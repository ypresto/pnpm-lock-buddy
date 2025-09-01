import type { PnpmLockfile } from "../core/lockfile.js";
import { parsePackageString } from "../core/parser.js";
import { matchesVersion } from "../core/matcher.js";
import { traverseLockfile } from "../core/traverser.js";
import { packageExists as checkPackageExists } from "../core/utils.js";
import {
  formatAsTree,
  formatAsJson,
  formatAsList,
  type FormattedResult,
} from "../core/formatter.js";

export interface ListOptions {
  exactMatch?: boolean;
  projectFilter?: string[];
}

export type OutputFormat = "tree" | "json" | "list";

export class ListUsecase {
  constructor(private lockfile: PnpmLockfile) {}

  /**
   * Search for packages in the lockfile
   */
  search(searchTerm: string, options: ListOptions = {}): FormattedResult[] {
    const results: FormattedResult[] = [];

    // Parse the search term
    const { name: targetPackage, version: targetVersion } =
      parsePackageString(searchTerm);
    const { exactMatch = false, projectFilter } = options;

    // Traverse the lockfile
    traverseLockfile(this.lockfile, (context) => {
      const { key, value, path } = context;

      // Check in importers section
      if (path[0] === "importers" && path.length === 4) {
        const importerPath = path[1];

        // Apply project filter if specified
        if (
          projectFilter &&
          importerPath &&
          !projectFilter.includes(importerPath)
        ) {
          return;
        }

        const depType = path[2] as
          | "dependencies"
          | "devDependencies"
          | "optionalDependencies";
        const isDepSection = [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
        ].includes(depType);

        if (isDepSection && key === targetPackage) {
          const depInfo = value as { specifier: string; version: string };

          // Check version match if specified
          if (
            !targetVersion ||
            matchesVersion(targetVersion, depInfo.specifier, exactMatch)
          ) {
            // Use the full version string which includes peer dependency constraints
            const fullVersion = depInfo.version;

            results.push({
              packageName: targetPackage,
              version: fullVersion || null,
              path: path,
              type:
                depType === "devDependencies"
                  ? "devDependency"
                  : depType === "optionalDependencies"
                    ? "optionalDependency"
                    : "dependency",
              parent: path[1],
              specifier: depInfo.specifier,
            });
          }
        }
      }

      // Check in packages section
      if (path[0] === "packages" && path.length === 2) {
        const packageId = key;
        const parsed = parsePackageString(packageId);

        if (parsed.name === targetPackage) {
          // Check version match if specified
          if (
            !targetVersion ||
            (exactMatch
              ? parsed.version === targetVersion
              : matchesVersion(targetVersion, parsed.version || "", false))
          ) {
            results.push({
              packageName: targetPackage,
              version: parsed.version,
              path: path,
              type: undefined,
              parent: undefined,
              specifier: packageId,
            });
          }
        }
      }

      // Check in snapshots section
      if (path[0] === "snapshots" && path.length === 2) {
        const snapshotId = key;
        const parsed = parsePackageString(snapshotId);

        if (parsed.name === targetPackage) {
          // For snapshots, also check version match
          if (
            !targetVersion ||
            (exactMatch
              ? parsed.version === targetVersion
              : matchesVersion(targetVersion, parsed.version || "", false))
          ) {
            results.push({
              packageName: targetPackage,
              version: parsed.version,
              path: path,
              type: undefined,
              parent: undefined,
              specifier: snapshotId,
            });
          }
        }
      }

      // Check dependencies within packages/snapshots
      if (
        (path[0] === "packages" || path[0] === "snapshots") &&
        path.length === 4 &&
        path[2] === "dependencies" &&
        key === targetPackage
      ) {
        const parentId = path[1];
        const version = value as string;

        results.push({
          packageName: targetPackage,
          version: version,
          path: path,
          type: "dependency",
          parent: parentId,
          specifier: undefined,
        });
      }
    });

    return results;
  }

  /**
   * List all packages in the lockfile
   */
  listAll(options: Pick<ListOptions, "projectFilter"> = {}): FormattedResult[] {
    const results: FormattedResult[] = [];
    const { projectFilter } = options;

    // Traverse the lockfile to collect all packages
    traverseLockfile(this.lockfile, (context) => {
      const { key, value, path } = context;

      // Check in importers section
      if (path[0] === "importers" && path.length === 4) {
        const importerPath = path[1];

        // Apply project filter if specified
        if (
          projectFilter &&
          importerPath &&
          !projectFilter.includes(importerPath)
        ) {
          return;
        }

        const depType = path[2] as
          | "dependencies"
          | "devDependencies"
          | "optionalDependencies";
        const isDepSection = [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
        ].includes(depType);

        if (isDepSection) {
          const depInfo = value as { specifier: string; version: string };

          results.push({
            packageName: key,
            version: depInfo.version || null,
            path: path,
            type:
              depType === "devDependencies"
                ? "devDependency"
                : depType === "optionalDependencies"
                  ? "optionalDependency"
                  : "dependency",
            parent: path[1],
            specifier: depInfo.specifier,
          });
        }
      }

      // Check in packages section
      if (path[0] === "packages" && path.length === 2) {
        const packageId = key;
        const parsed = parsePackageString(packageId);

        results.push({
          packageName: parsed.name,
          version: parsed.version,
          path: path,
          type: undefined,
          parent: undefined,
          specifier: packageId,
        });
      }

      // Check in snapshots section
      if (path[0] === "snapshots" && path.length === 2) {
        const snapshotId = key;
        const parsed = parsePackageString(snapshotId);

        results.push({
          packageName: parsed.name,
          version: parsed.version,
          path: path,
          type: undefined,
          parent: undefined,
          specifier: snapshotId,
        });
      }
    });

    return results;
  }

  /**
   * Check if a package exists in the lockfile
   */
  packageExists(packageName: string): boolean {
    return checkPackageExists(this.lockfile, packageName);
  }

  /**
   * Format search results
   */
  formatResults(
    results: FormattedResult[],
    format: OutputFormat = "tree",
  ): string {
    switch (format) {
      case "json":
        return formatAsJson(results);
      case "list":
        return formatAsList(results);
      case "tree":
      default:
        return formatAsTree(results);
    }
  }
}
