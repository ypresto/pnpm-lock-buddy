import { Command } from "commander";
import { loadLockfile } from "../../core/lockfile.js";
import { ListUsecase, type OutputFormat } from "../../usecases/list.usecase.js";
import {
  findLinkDependencies,
  displayLinkDependencyWarning,
} from "../../core/utils.js";
import chalk from "chalk";

export function createListCommand(): Command {
  const command = new Command("list")
    .alias("search")
    .description("Search for packages in pnpm-lock.yaml")
    .argument(
      "[package]",
      'Package name to search for (e.g., "lodash" or "lodash@4.17.21"). If not provided, lists all packages.',
    )
    .option("-f, --file <path>", "Path to pnpm-lock.yaml file")
    .option(
      "-e, --exact",
      "Only match exact versions (disable semver matching)",
    )
    .option(
      "-p, --project <projects...>",
      'Filter by specific importer/project paths (e.g., "apps/web" "packages/ui")',
    )
    .option("-o, --output <format>", "Output format: tree, json, list", "tree")
    .action((packageName: string | undefined, options) => {
      try {
        // Load lockfile
        const lockfile = loadLockfile(options.file);

        // Create usecase
        const listUsecase = new ListUsecase(lockfile);

        let results;

        if (packageName) {
          // Check for link dependencies first
          const linkDeps = findLinkDependencies(lockfile, [packageName]);
          if (linkDeps.length > 0) {
            displayLinkDependencyWarning(linkDeps);
          }

          // Check if package exists
          if (!listUsecase.packageExists(packageName)) {
            console.error(
              chalk.red(
                `Error: Package "${packageName}" not listed in the lock file`,
              ),
            );
            process.exit(1);
          }

          // Search for specific package
          const projectFilter = options.project
            ? ` (projects: ${options.project.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Searching for "${packageName}" in ${options.file || "pnpm-lock.yaml"}${options.exact ? " (exact match)" : ""}${projectFilter}...\n`,
            ),
          );

          results = listUsecase.search(packageName, {
            exactMatch: options.exact,
            projectFilter: options.project,
          });
        } else {
          // List all packages
          const projectFilter = options.project
            ? ` (projects: ${options.project.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Listing all packages in ${options.file || "pnpm-lock.yaml"}${projectFilter}...\n`,
            ),
          );

          results = listUsecase.listAll({
            projectFilter: options.project,
          });
        }

        // Format and display results
        if (results.length === 0) {
          if (options.output !== "json") {
            console.log(
              chalk.yellow(
                packageName ? "No matches found." : "No packages found.",
              ),
            );
          }
        } else {
          if (options.output !== "json") {
            console.error(
              chalk.green(
                `Found ${results.length} ${packageName ? "match(es)" : "package(s)"}:\n`,
              ),
            );
          }

          const output = listUsecase.formatResults(
            results,
            options.output as OutputFormat,
          );

          console.log(output);
        }
      } catch (error) {
        console.error(
          chalk.red("Error:"),
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });

  return command;
}
