import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolves the newest published version for a pnpm major line (e.g. 11 ->
 * "11.25.0"), so tests always exercise the latest release of each major
 * instead of a version pinned at write time that eventually goes stale.
 */
export function resolveLatestPnpmVersion(major: number): string {
  const raw = execFileSync(
    "pnpm",
    ["view", `pnpm@${major}`, "version", "--json"],
    {
      encoding: "utf-8",
    },
  );
  const versions: unknown = JSON.parse(raw);
  const list = Array.isArray(versions) ? versions : [versions];
  const latest = list[list.length - 1];
  if (typeof latest !== "string") {
    throw new Error(
      `Could not resolve latest pnpm@${major} version from: ${raw}`,
    );
  }
  return latest;
}

/**
 * Copies `fixtureDir` into a fresh temp directory, pins `packageManager` to
 * the given pnpm version (matching how real-world workspaces are set up),
 * and runs a real `pnpm install` there using that exact pnpm version fetched
 * via `pnpm dlx` — never this repo's own pinned pnpm, and never a
 * hand-written or synthetic lockfile. Returns the temp directory so callers
 * can point pnpm-lock-buddy at the real `pnpm-lock.yaml` it produced.
 */
export function realPnpmInstall(
  fixtureDir: string,
  pnpmVersion: string,
): string {
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pnpm-lock-buddy-e2e-"),
  );
  fs.cpSync(fixtureDir, workDir, { recursive: true });

  const pkgJsonPath = path.join(workDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  pkg.packageManager = `pnpm@${pnpmVersion}`;
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");

  execFileSync(
    "pnpm",
    ["dlx", `pnpm@${pnpmVersion}`, "-C", workDir, "install"],
    {
      stdio: "pipe",
    },
  );

  return workDir;
}
