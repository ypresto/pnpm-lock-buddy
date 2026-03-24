import { describe, it, expect } from "vitest";
import { parseIgnoreFile } from "../../../src/core/ignore-file.js";

describe("parseIgnoreFile", () => {
  it("parses project-level ignore lines", () => {
    const result = parseIgnoreFile("apps/storybook\npackages/e2e-tests");
    expect(result).toEqual({
      projects: ["apps/storybook", "packages/e2e-tests"],
      packageProjects: [],
    });
  });

  it("parses package+project pair lines (project:package)", () => {
    const result = parseIgnoreFile(
      "apps/web:react\npackages/ui:@types/react",
    );
    expect(result).toEqual({
      projects: [],
      packageProjects: [
        { project: "apps/web", package: "react" },
        { project: "packages/ui", package: "@types/react" },
      ],
    });
  });

  it("handles mixed lines with comments and blank lines", () => {
    const content = [
      "# This is a comment",
      "",
      "apps/storybook",
      "  # Indented comment",
      "",
      "apps/web:react",
      "packages/ui:@types/react",
      "packages/e2e-tests",
    ].join("\n");

    const result = parseIgnoreFile(content);
    expect(result).toEqual({
      projects: ["apps/storybook", "packages/e2e-tests"],
      packageProjects: [
        { project: "apps/web", package: "react" },
        { project: "packages/ui", package: "@types/react" },
      ],
    });
  });

  it("returns empty arrays for empty content", () => {
    const result = parseIgnoreFile("");
    expect(result).toEqual({
      projects: [],
      packageProjects: [],
    });
  });

  it("returns empty arrays for content with only comments", () => {
    const result = parseIgnoreFile("# comment\n# another comment\n");
    expect(result).toEqual({
      projects: [],
      packageProjects: [],
    });
  });

  it("trims whitespace from lines", () => {
    const result = parseIgnoreFile("  apps/storybook  \n  apps/web:react  ");
    expect(result).toEqual({
      projects: ["apps/storybook"],
      packageProjects: [{ project: "apps/web", package: "react" }],
    });
  });

  it("splits on first colon only (scoped packages have colons in paths but project paths do not)", () => {
    const result = parseIgnoreFile("apps/web:@scope/package");
    expect(result).toEqual({
      projects: [],
      packageProjects: [{ project: "apps/web", package: "@scope/package" }],
    });
  });
});
