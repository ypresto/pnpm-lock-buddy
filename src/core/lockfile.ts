import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { LockfileFile } from "@pnpm/lockfile.types";

export type PnpmLockfile = Pick<
  LockfileFile,
  "importers" | "packages" | "snapshots" | "lockfileVersion"
>;

// Cache for loaded lockfiles
const lockfileCache = new Map<string, PnpmLockfile>();

/**
 * Load and parse a pnpm-lock.yaml file
 * @param filePath - Path to the lockfile (optional)
 * @returns Parsed lockfile object
 */
export function loadLockfile(filePath?: string): PnpmLockfile {
  // Determine the file path
  const resolvedPath =
    filePath ||
    process.env.PNPM_LOCK_PATH ||
    path.join(process.cwd(), "pnpm-lock.yaml");

  // Check cache
  if (lockfileCache.has(resolvedPath)) {
    return lockfileCache.get(resolvedPath)!;
  }

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Lockfile not found at ${resolvedPath}`);
  }

  try {
    // Read and parse the file
    const fileContent = fs.readFileSync(resolvedPath, "utf8");

    // pnpm v11+ writes an "env" document (configDependencies /
    // packageManagerDependencies) ahead of the project document when config
    // dependencies or a pinned pnpm version are present, producing a
    // multi-document YAML file separated by `---`. Per pnpm's own guidance
    // for dependency-graph consumers (https://pnpm.io/lockfile), load all
    // documents and use the last one, which is always the project document.
    // A trailing `---` separator with nothing after it (or a blank document)
    // yields a trailing `null` entry; skip those so they don't shadow the
    // real project document that precedes them.
    const documents = yaml.loadAll(fileContent) as unknown[];
    const parsed = documents.filter((d) => d != null).at(-1) as any;

    // Validate basic structure
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid lockfile format");
    }

    if (!parsed.lockfileVersion) {
      throw new Error("Missing lockfileVersion in lockfile");
    }

    // Extract only the fields we need
    const lockfile: PnpmLockfile = {
      lockfileVersion: parsed.lockfileVersion,
      importers: parsed.importers || {},
      packages: parsed.packages || {},
      snapshots: parsed.snapshots || {},
    };

    // Cache the result
    lockfileCache.set(resolvedPath, lockfile);

    return lockfile;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to load lockfile at ${resolvedPath}: ${error.message}`,
      );
    }
    throw error;
  }
}

/**
 * Clear the lockfile cache
 */
export function clearLockfileCache(): void {
  lockfileCache.clear();
}
