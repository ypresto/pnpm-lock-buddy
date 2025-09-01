import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadLockfile, type PnpmLockfile } from "../../../src/core/lockfile";
import fs from "fs";
import path from "path";

vi.mock("fs");

describe("loadLockfile", () => {
  const mockLockfileContent = `
lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
importers:
  .:
    dependencies:
      express:
        specifier: 4.18.2
        version: 4.18.2
packages:
  express@4.18.2:
    resolution: {integrity: sha512-test}
`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.PNPM_LOCK_PATH;
  });

  it("should load lockfile from specified path", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockLockfileContent);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = loadLockfile("/custom/path/pnpm-lock.yaml");

    expect(fs.readFileSync).toHaveBeenCalledWith(
      "/custom/path/pnpm-lock.yaml",
      "utf8",
    );
    expect(result.lockfileVersion).toBe("9.0");
    expect(result.importers["."]).toBeDefined();
    expect(result.packages).toBeDefined();
  });

  it("should load lockfile from environment variable", () => {
    process.env.PNPM_LOCK_PATH = "/env/path/pnpm-lock.yaml";
    vi.mocked(fs.readFileSync).mockReturnValue(mockLockfileContent);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = loadLockfile();

    expect(fs.readFileSync).toHaveBeenCalledWith(
      "/env/path/pnpm-lock.yaml",
      "utf8",
    );
    expect(result.lockfileVersion).toBe("9.0");
  });

  it("should load lockfile from default path", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockLockfileContent);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = loadLockfile();

    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("pnpm-lock.yaml"),
      "utf8",
    );
    expect(result.lockfileVersion).toBe("9.0");
  });

  it("should throw error if lockfile does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => loadLockfile("/missing/file.yaml")).toThrow(
      "Lockfile not found at /missing/file.yaml",
    );
  });

  it("should throw error if lockfile is invalid", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("invalid yaml: [}");
    vi.mocked(fs.existsSync).mockReturnValue(true);

    expect(() => loadLockfile("/invalid/file.yaml")).toThrow();
  });

  it("should cache loaded lockfile", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockLockfileContent);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result1 = loadLockfile("/cached/file.yaml");
    const result2 = loadLockfile("/cached/file.yaml");

    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    expect(result1).toBe(result2); // Same reference
  });

  it("should handle lockfile without optional sections", () => {
    const minimalLockfile = `
lockfileVersion: '9.0'
importers: {}
packages: {}
`;
    vi.mocked(fs.readFileSync).mockReturnValue(minimalLockfile);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = loadLockfile("/minimal/file.yaml");

    expect(result.lockfileVersion).toBe("9.0");
    expect(result.importers).toEqual({});
    expect(result.packages).toEqual({});
    expect(result.settings).toBeUndefined();
  });
});
