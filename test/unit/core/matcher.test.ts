import { describe, it, expect } from "vitest";
import {
  matchesVersion,
  parseVersionSpecifier,
} from "../../../src/core/matcher";

describe("parseVersionSpecifier", () => {
  it("should parse simple version", () => {
    const result = parseVersionSpecifier("1.2.3");
    expect(result).toEqual(["1.2.3"]);
  });

  it("should parse version range", () => {
    const result = parseVersionSpecifier("^1.2.3");
    expect(result).toEqual(["^1.2.3"]);
  });

  it("should parse OR conditions", () => {
    const result = parseVersionSpecifier("^7.0.0 || ^8.0.1");
    expect(result).toEqual(["^7.0.0", "^8.0.1"]);
  });

  it("should parse multiple OR conditions", () => {
    const result = parseVersionSpecifier(">=1.0.0 || ^2.0.0 || ~3.0.0");
    expect(result).toEqual([">=1.0.0", "^2.0.0", "~3.0.0"]);
  });

  it("should handle extra whitespace", () => {
    const result = parseVersionSpecifier("  ^7.0.0   ||   ^8.0.1  ");
    expect(result).toEqual(["^7.0.0", "^8.0.1"]);
  });
});

describe("matchesVersion", () => {
  describe("normal mode", () => {
    it("should match exact version", () => {
      expect(matchesVersion("1.2.3", "1.2.3")).toBe(true);
      expect(matchesVersion("1.2.3", "1.2.4")).toBe(false);
    });

    it("should match caret range", () => {
      expect(matchesVersion("1.2.3", "^1.2.0")).toBe(true);
      expect(matchesVersion("1.3.0", "^1.2.0")).toBe(true);
      expect(matchesVersion("2.0.0", "^1.2.0")).toBe(false);
    });

    it("should match tilde range", () => {
      expect(matchesVersion("1.2.3", "~1.2.0")).toBe(true);
      expect(matchesVersion("1.2.10", "~1.2.0")).toBe(true);
      expect(matchesVersion("1.3.0", "~1.2.0")).toBe(false);
    });

    it("should match OR conditions", () => {
      expect(matchesVersion("7.5.0", "^7.0.0 || ^8.0.1")).toBe(true);
      expect(matchesVersion("8.5.6", "^7.0.0 || ^8.0.1")).toBe(true);
      expect(matchesVersion("6.0.0", "^7.0.0 || ^8.0.1")).toBe(false);
      expect(matchesVersion("9.0.0", "^7.0.0 || ^8.0.1")).toBe(false);
    });

    it("should handle complex ranges", () => {
      expect(matchesVersion("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
      expect(matchesVersion("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    });

    it("should handle wildcards", () => {
      expect(matchesVersion("1.2.3", "1.x")).toBe(true);
      expect(matchesVersion("1.9.0", "1.x")).toBe(true);
      expect(matchesVersion("2.0.0", "1.x")).toBe(false);
    });
  });

  describe("exact mode", () => {
    it("should only match exact version", () => {
      expect(matchesVersion("1.2.3", "1.2.3", true)).toBe(true);
      expect(matchesVersion("1.2.3", "1.2.4", true)).toBe(false);
    });

    it("should not match ranges in exact mode", () => {
      expect(matchesVersion("1.2.3", "^1.2.0", true)).toBe(false);
      expect(matchesVersion("1.2.3", "~1.2.0", true)).toBe(false);
      expect(matchesVersion("1.2.3", "1.x", true)).toBe(false);
    });

    it("should not match OR conditions in exact mode", () => {
      expect(matchesVersion("8.5.6", "^7.0.0 || ^8.0.1", true)).toBe(false);
      expect(matchesVersion("8.5.6", "8.5.6 || 9.0.0", true)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle invalid versions gracefully", () => {
      expect(matchesVersion("not-a-version", "1.2.3")).toBe(false);
      expect(matchesVersion("1.2.3", "not-a-version")).toBe(false);
    });

    it("should handle empty strings", () => {
      expect(matchesVersion("", "1.2.3")).toBe(false);
      expect(matchesVersion("1.2.3", "")).toBe(false);
    });

    it("should handle null/undefined", () => {
      expect(matchesVersion(null as any, "1.2.3")).toBe(false);
      expect(matchesVersion("1.2.3", null as any)).toBe(false);
    });
  });
});
