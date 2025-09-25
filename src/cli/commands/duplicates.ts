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
    .option(
      "--deps",
      "Show dependency tree paths from root to target packages",
    )
    .option(
      "--deps-depth <number>",
      "Limit dependency tree display depth (e.g., --deps-depth=3 shows max 3 levels with '...' for deeper paths)",
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
        // Parse deps options
        const showDependencyTree = options.deps === true;
        const compactTreeDepth = options.depsDepth ? Number(options.depsDepth) : undefined;

        // Load lockfile
        const lockfile = loadLockfile(options.file);

        // Create usecase
        const duplicatesUsecase = new DuplicatesUsecase(lockfile);

        // Validate project filter if specified
        if (options.project && options.project.length > 0) {
          const availableProjects = Object.keys(lockfile.importers || {});
          const missingProjects = options.project.filter(
            (project: string) => !availableProjects.includes(project)
          );

          if (missingProjects.length > 0) {
            console.error(
              chalk.red(
                `Error: Project${missingProjects.length > 1 ? "s" : ""} not found: ${missingProjects.join(", ")}\\n` +
                `Available projects:\\n${availableProjects.map(p => `  - ${p}`).join("\\n")}`
              )
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
        if (options.project && !options.perProject) {
          // Check if there are multiple resolution variants by running a quick check
          const globalDuplicates = duplicatesUsecase.findDuplicates({
            showAll: true,
            packageFilter: packageNames.length > 0 ? packageNames : undefined,
            projectFilter: options.project,
            omitTypes: options.omit,
          });
          
          // Check if any package has file variants or multiple resolution contexts
          for (const duplicate of globalDuplicates) {
            for (const instance of duplicate.instances) {
              if (instance.dependencyInfo && instance.dependencyInfo.path.some(step => step.package.includes('@file:'))) {
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
          const projectFilterText = options.project
            ? ` (projects: ${options.project.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Analyzing ${options.file || "pnpm-lock.yaml"} for per-project duplicates${packageFilterText}${projectFilterText}...\\n`,
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
                  `Found duplicates in ${perProjectDuplicates.length} project(s) with ${totalPackages} duplicate package(s):\\n`,
                ),
              );
            }

            const output = duplicatesUsecase.formatPerProjectResults(
              perProjectDuplicates,
              options.output as OutputFormat,
              showDependencyTree,
              parseInt(options.maxDepth),
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
          const projectFilterText = options.project
            ? ` (projects: ${options.project.join(", ")})`
            : "";
          console.error(
            chalk.gray(
              `Analyzing ${options.file || "pnpm-lock.yaml"} for duplicate packages${packageFilterText}${projectFilterText}...\\n`,
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
                  `Found ${duplicates.length} package(s) with ${totalInstances} total instances:\\n`,
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
