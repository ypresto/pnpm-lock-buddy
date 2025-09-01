import { describe, it, expect } from "vitest";
import {
  formatAsTree,
  formatAsJson,
  formatAsList,
  groupByPackage,
  type FormattedResult,
} from "../../../src/core/formatter";

describe("groupByPackage", () => {
  it("should group results by package name", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
      {
        packageName: "express",
        version: "4.18.2",
        path: ["packages", "express@4.18.2"],
        type: undefined,
        parent: undefined,
        specifier: undefined,
      },
      {
        packageName: "lodash",
        version: "4.17.21",
        path: ["importers", "packages/app", "dependencies", "lodash"],
        type: "dependency",
        parent: "packages/app",
        specifier: "4.17.21",
      },
    ];

    const grouped = groupByPackage(results);

    expect(Object.keys(grouped)).toEqual(["express", "lodash"]);
    expect(grouped.express).toHaveLength(2);
    expect(grouped.lodash).toHaveLength(1);
  });
});

describe("formatAsTree", () => {
  it("should format single result as tree", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
    ];

    const output = formatAsTree(results);

    expect(output).toContain("express");
    expect(output).toContain("importers");
    expect(output).toContain("dependencies");
    expect(output).toContain("^4.18.0");
    expect(output).toContain("4.18.2");
  });

  it("should format grouped results with proper indentation", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
      {
        packageName: "express",
        version: "4.18.2",
        path: ["packages", "express@4.18.2"],
        type: undefined,
        parent: undefined,
        specifier: undefined,
      },
    ];

    const output = formatAsTree(results);
    const lines = output.split("\n");

    // Check structure
    expect(lines.some((l) => l.includes("importers"))).toBe(true);
    expect(lines.some((l) => l.includes("packages"))).toBe(true);

    // Check indentation exists
    expect(lines.some((l) => l.startsWith("  "))).toBe(true);
  });

  it("should show type for dependencies", () => {
    const results: FormattedResult[] = [
      {
        packageName: "vitest",
        version: "1.0.0",
        path: ["importers", ".", "devDependencies", "vitest"],
        type: "devDependency",
        parent: ".",
        specifier: "^1.0.0",
      },
    ];

    const output = formatAsTree(results);

    expect(output).toContain("devDependencies");
  });
});

describe("formatAsJson", () => {
  it("should format results as JSON", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
    ];

    const output = formatAsJson(results);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      packageName: "express",
      version: "4.18.2",
      type: "dependency",
    });
  });

  it("should pretty print JSON", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
    ];

    const output = formatAsJson(results);

    // Check for indentation
    expect(output.includes("  ")).toBe(true);
    expect(output.split("\n").length).toBeGreaterThan(1);
  });
});

describe("formatAsList", () => {
  it("should format results as simple list", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
      {
        packageName: "lodash",
        version: "4.17.21",
        path: ["packages", "lodash@4.17.21"],
        type: undefined,
        parent: undefined,
        specifier: undefined,
      },
    ];

    const output = formatAsList(results);
    const lines = output.split("\n").filter((l) => l.trim());

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("express@4.18.2");
    expect(lines[0]).toContain("importers > . > dependencies");
    expect(lines[1]).toContain("lodash@4.17.21");
    expect(lines[1]).toContain("packages");
  });

  it("should show specifier when available", () => {
    const results: FormattedResult[] = [
      {
        packageName: "express",
        version: "4.18.2",
        path: ["importers", ".", "dependencies", "express"],
        type: "dependency",
        parent: ".",
        specifier: "^4.18.0",
      },
    ];

    const output = formatAsList(results);

    expect(output).toContain("^4.18.0");
  });
});
