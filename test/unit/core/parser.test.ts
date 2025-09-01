import { describe, it, expect } from "vitest";
import {
  parsePackageString,
  type ParsedPackage,
} from "../../../src/core/parser";

describe("parsePackageString", () => {
  it("should parse simple package name", () => {
    const result = parsePackageString("lodash");
    expect(result).toEqual<ParsedPackage>({
      name: "lodash",
      version: null,
      scope: null,
      dependencies: {},
    });
  });

  it("should parse package with version", () => {
    const result = parsePackageString("lodash@4.17.21");
    expect(result).toEqual<ParsedPackage>({
      name: "lodash",
      version: "4.17.21",
      scope: null,
      dependencies: {},
    });
  });

  it("should parse scoped package", () => {
    const result = parsePackageString("@company/shared-utils");
    expect(result).toEqual<ParsedPackage>({
      name: "@company/shared-utils",
      version: null,
      scope: "@company",
      dependencies: {},
    });
  });

  it("should parse scoped package with version", () => {
    const result = parsePackageString("@company/shared-utils@1.0.0");
    expect(result).toEqual<ParsedPackage>({
      name: "@company/shared-utils",
      version: "1.0.0",
      scope: "@company",
      dependencies: {},
    });
  });

  it("should parse package with dependencies", () => {
    const result = parsePackageString("vitest@1.2.0(@types/node@20.10.0)");
    expect(result).toEqual<ParsedPackage>({
      name: "vitest",
      version: "1.2.0",
      scope: null,
      dependencies: {
        "@types/node": "20.10.0",
      },
    });
  });

  it("should parse package with multiple dependencies", () => {
    const result = parsePackageString("package@1.0.0(dep1@1.0.0)(dep2@2.0.0)");
    expect(result).toEqual<ParsedPackage>({
      name: "package",
      version: "1.0.0",
      scope: null,
      dependencies: {
        dep1: "1.0.0",
        dep2: "2.0.0",
      },
    });
  });

  it("should parse scoped package with scoped dependencies", () => {
    const result = parsePackageString("@org/package@1.0.0(@org/dep@1.0.0)");
    expect(result).toEqual<ParsedPackage>({
      name: "@org/package",
      version: "1.0.0",
      scope: "@org",
      dependencies: {
        "@org/dep": "1.0.0",
      },
    });
  });

  it("should handle invalid input gracefully", () => {
    expect(() => parsePackageString("")).toThrow("Invalid package string");
    expect(() => parsePackageString(null as any)).toThrow(
      "Invalid package string",
    );
    expect(() => parsePackageString(undefined as any)).toThrow(
      "Invalid package string",
    );
  });
});
