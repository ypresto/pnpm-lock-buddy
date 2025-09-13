import { Command } from "commander";
import { loadLockfile } from "../../core/lockfile.js";
import {
  DuplicatesUsecase,
  type OutputFormat,
} from "../../usecases/duplicates.usecase.js";
import chalk from "chalk";

export function createDuplicatesCommand(): Command {
  const command = new Command("duplicates")
    .alias("dupes")
    .description("Find packages with multiple installations")
    .argument(
      "[packages...]",
      'Package names to filter, supports wildcards (e.g., "react*" "@types/*" "*eslint*")',
    )
    .option("-f, --file <path>", "Path to pnpm-lock.yaml file")
    .option("-a, --all", "Show all packages, not just duplicates")
    .option(
      "-p, --per-project",
      "Group duplicates by importer/project instead of globally",
    )
    .option(
      "--project <projects...>",
      'Filter by specific importer/project paths (e.g., "apps/web" "packages/ui")',
    )
    .option(
      "--omit <types...>",
      'Omit dependency types: "dev", "optional", "peer" (e.g., --omit=dev --omit=optional)',
    )
    .option("--deps", "Show dependency tree paths from root to target packages")
    .option(
      "--compact-tree",
      "Show compact dependency tree with '...' for middle sections when tree is deep",
    )
    .option(
      "--number-versions",
      "Assign reference numbers to package versions for easier identification",
    )
    .option(
      "--max-depth <number>",
      "Maximum depth for dependency path traversal (default: 10)",
      "10",
    )
    .option(
      "--exit-code",
      "Exit with code 1 if duplicate packages are found (useful for CI/CD)",
    )
    .option("-o, --output <format>", "Output format: tree, json", "tree")
    .action((packageNames: string[], options) => {
      try {
        // Load lockfile
        const lockfile = loadLockfile(options.file);

        // Create usecase
        const duplicatesUsecase = new DuplicatesUsecase(lockfile);

        // Check if non-wildcard packages exist
        if (packageNames.length > 0) {
          const nonWildcardNames = packageNames.filter(
            (name) => !name.includes("*"),
          );

          if (nonWildcardNames.length > 0) {
            const { missing } =
              duplicatesUsecase.packagesExist(nonWildcardNames);
            if (missing.length > 0) {
              console.error(
                chalk.red(
                  `Error: Package${missing.length > 1 ? "s" : ""} "${missing.join(", ")}" not listed in the lock file`,
                ),
              );
              process.exit(1);
            }
          }
        }

        let hasDuplicates = false;

        if (options.perProject) {
          // Find per-project duplicates
          const packageFilterText =
            packageNames.length > 0
              ? ` (packages: ${packageNames.join(", ")})`
              : "";
          const projectFilterText = options.project
            ? ` (projects: ${options.project.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Analyzing ${options.file || "pnpm-lock.yaml"} for per-project duplicates${packageFilterText}${projectFilterText}...\n`,
            ),
          );

          const perProjectDuplicates =
            duplicatesUsecase.findPerProjectDuplicates({
              showAll: options.all,
              packageFilter: packageNames.length > 0 ? packageNames : undefined,
              projectFilter: options.project,
              omitTypes: options.omit,
              maxDepth: parseInt(options.maxDepth),
            });

          hasDuplicates = perProjectDuplicates.length > 0;

          // Format and display results
          if (perProjectDuplicates.length === 0) {
            if (options.output !== "json") {
              console.log(
                chalk.yellow("No per-project duplicate packages found."),
              );
            }
          } else {
            if (options.output !== "json") {
              const totalPackages = perProjectDuplicates.reduce(
                (sum, dup) => sum + dup.duplicatePackages.length,
                0,
              );

              console.error(
                chalk.green(
                  `Found duplicates in ${perProjectDuplicates.length} project(s) with ${totalPackages} duplicate package(s):\n`,
                ),
              );
            }

            const output = duplicatesUsecase.formatPerProjectResults(
              perProjectDuplicates,
              options.output as OutputFormat,
              options.deps,
              parseInt(options.maxDepth),
              options.compactTree,
              options.numberVersions,
            );

            console.log(output);
          }
        } else {
          // Find global duplicates (existing behavior)
          const packageFilterText =
            packageNames.length > 0
              ? ` (packages: ${packageNames.join(", ")})`
              : "";
          const projectFilterText = options.project
            ? ` (projects: ${options.project.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Analyzing ${options.file || "pnpm-lock.yaml"} for duplicate packages${packageFilterText}${projectFilterText}...\n`,
            ),
          );

          const duplicates = duplicatesUsecase.findDuplicates({
            showAll: options.all,
            packageFilter: packageNames.length > 0 ? packageNames : undefined,
            projectFilter: options.project,
            omitTypes: options.omit,
          });

          hasDuplicates = duplicates.length > 0;

          // Format and display results
          if (duplicates.length === 0) {
            if (options.output !== "json") {
              console.log(chalk.yellow("No duplicate packages found."));
            }
          } else {
            if (options.output !== "json") {
              const totalInstances = duplicates.reduce(
                (sum, dup) => sum + dup.instances.length,
                0,
              );

              console.error(
                chalk.green(
                  `Found ${duplicates.length} package(s) with ${totalInstances} total instances:\n`,
                ),
              );
            }

            const output = duplicatesUsecase.formatResults(
              duplicates,
              options.output as OutputFormat,
              options.deps,
              options.compactTree,
              options.numberVersions,
            );

            console.log(output);
          }
        }

        // Exit with code 1 if duplicates found and --exit-code is specified
        if (options.exitCode && hasDuplicates && !options.all) {
          process.exit(1);
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
