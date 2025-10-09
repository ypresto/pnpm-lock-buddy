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
      "--project <projects>",
      'Filter by specific importer/project paths, comma-separated (e.g., "apps/web,packages/ui")',
    )
    .option(
      "--omit <types...>",
      'Omit dependency types: "dev", "optional", "peer" (e.g., --omit=dev --omit=optional)',
    )
    .option("--deps", "Show dependency tree paths from root to target packages")
    .option(
      "--deps-depth <number>",
      "Limit dependency tree display depth (e.g., --deps-depth=3 shows max 3 levels with '...' for deeper paths)",
    )
    .option(
      "--depth <number>",
      "Depth for building dependency tree (default: 10, use higher for deep monorepos)",
      "10",
    )
    .option(
      "--exit-code",
      "Exit with code 1 if duplicate packages are found (useful for CI/CD)",
    )
    .option(
      "--hoist",
      "Check node_modules/.modules.yaml for actually hoisted package conflicts",
    )
    .option(
      "--modules-dir <path>",
      "Path to node_modules directory (for --hoist)",
      "node_modules",
    )
    .option("-o, --output <format>", "Output format: tree, json", "tree")
    .action(async (packageNames: string[], options) => {
      try {
        // Parse deps options
        const showDependencyTree = options.deps === true;
        const compactTreeDepth = options.depsDepth
          ? Number(options.depsDepth)
          : undefined;

        // Determine lockfile path
        const lockfilePath =
          options.file || process.env.PNPM_LOCK_PATH || "pnpm-lock.yaml";

        // Load lockfile for validation
        const lockfile = loadLockfile(lockfilePath);

        // Create usecase with file path
        const depth = parseInt(options.depth);
        const duplicatesUsecase = new DuplicatesUsecase(
          lockfilePath,
          lockfile,
          depth,
        );

        // Parse and validate project filter if specified
        const projectFilter = options.project
          ? options.project.split(",").map((p: string) => p.trim())
          : undefined;

        if (projectFilter && projectFilter.length > 0) {
          const availableProjects = Object.keys(lockfile.importers || {});
          const missingProjects = projectFilter.filter(
            (project: string) => !availableProjects.includes(project),
          );

          if (missingProjects.length > 0) {
            console.error(
              chalk.red(
                `Error: Project${missingProjects.length > 1 ? "s" : ""} not found: ${missingProjects.join(", ")}\n` +
                  `Available projects:\n${availableProjects.map((p) => `  - ${p}`).join("\n")}`,
              ),
            );
            process.exit(1);
          }
        }

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

        // Auto-detect if we should use per-project format when --project is specified
        let usePerProject = options.perProject;
        if (projectFilter && !options.perProject) {
          // Check if there are multiple resolution variants by running a quick check
          const globalDuplicates = await duplicatesUsecase.findDuplicates({
            showAll: true,
            packageFilter: packageNames.length > 0 ? packageNames : undefined,
            projectFilter: projectFilter,
            omitTypes: options.omit,
          });

          // Check if any package has file variants or multiple resolution contexts
          for (const duplicate of globalDuplicates) {
            for (const instance of duplicate.instances) {
              if (
                instance.dependencyInfo &&
                instance.dependencyInfo.path.some((step) =>
                  step.package.includes("@file:"),
                )
              ) {
                usePerProject = true;
                break;
              }
            }
            if (usePerProject) break;
          }
        }

        if (usePerProject) {
          // Find per-project duplicates
          const packageFilterText =
            packageNames.length > 0
              ? ` (packages: ${packageNames.join(", ")})`
              : "";
          const projectFilterText = projectFilter
            ? ` (projects: ${projectFilter.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Analyzing ${options.file || "pnpm-lock.yaml"} for per-project duplicates${packageFilterText}${projectFilterText}...\n`,
            ),
          );

          const perProjectDuplicates =
            await duplicatesUsecase.findPerProjectDuplicates({
              showAll: options.all,
              packageFilter: packageNames.length > 0 ? packageNames : undefined,
              projectFilter: projectFilter,
              omitTypes: options.omit,
              checkHoist: options.hoist,
              modulesDir: options.modulesDir,
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
              showDependencyTree,
              compactTreeDepth,
            );

            console.log(output);
          }
        } else {
          // Find global duplicates (existing behavior)
          const packageFilterText =
            packageNames.length > 0
              ? ` (packages: ${packageNames.join(", ")})`
              : "";
          const projectFilterText = projectFilter
            ? ` (projects: ${projectFilter.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Analyzing ${options.file || "pnpm-lock.yaml"} for duplicate packages${packageFilterText}${projectFilterText}...\n`,
            ),
          );

          const duplicates = await duplicatesUsecase.findDuplicates({
            showAll: options.all,
            packageFilter: packageNames.length > 0 ? packageNames : undefined,
            projectFilter: options.project,
            omitTypes: options.omit,
            checkHoist: options.hoist,
            modulesDir: options.modulesDir,
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
              showDependencyTree,
              compactTreeDepth,
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
