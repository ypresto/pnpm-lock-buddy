export interface IgnoreFileResult {
  projects: string[];
  packageProjects: Array<{ project: string; package: string }>;
}

export function parseIgnoreFile(content: string): IgnoreFileResult {
  const projects: string[] = [];
  const packageProjects: Array<{ project: string; package: string }> = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      projects.push(line);
    } else {
      packageProjects.push({
        project: line.substring(0, colonIndex),
        package: line.substring(colonIndex + 1),
      });
    }
  }

  return { projects, packageProjects };
}
