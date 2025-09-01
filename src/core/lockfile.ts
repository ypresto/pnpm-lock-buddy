import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export interface PnpmLockfile {
  lockfileVersion: string;
  settings?: {
    autoInstallPeers?: boolean;
    excludeLinksFromLockfile?: boolean;
    [key: string]: any;
  };
  importers: {
    [path: string]: {
      dependencies?: Record<string, { specifier: string; version: string }>;
      devDependencies?: Record<string, { specifier: string; version: string }>;
      optionalDependencies?: Record<
        string,
        { specifier: string; version: string }
      >;
    };
  };
  packages: {
    [packageId: string]: {
      resolution: {
        integrity: string;
        [key: string]: any;
      };
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      engines?: Record<string, string>;
      [key: string]: any;
    };
  };
  snapshots?: {
    [packageId: string]: {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      [key: string]: any;
    };
  };
}

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
    const lockfile = yaml.load(fileContent) as PnpmLockfile;

    // Validate basic structure
    if (!lockfile || typeof lockfile !== "object") {
      throw new Error("Invalid lockfile format");
    }

    if (!lockfile.lockfileVersion) {
      throw new Error("Missing lockfileVersion in lockfile");
    }

    // Ensure required sections exist
    lockfile.importers = lockfile.importers || {};
    lockfile.packages = lockfile.packages || {};

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
