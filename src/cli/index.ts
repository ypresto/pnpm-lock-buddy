#!/usr/bin/env node

import { Command } from "commander";
import { createListCommand } from "./commands/list.js";
import { createDuplicatesCommand } from "./commands/duplicates.js";
import chalk from "chalk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get package.json info
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8"),
);

// Create main program
const program = new Command()
  .name("pnpm-lock-buddy")
  .description("CLI tool for analyzing pnpm-lock.yaml files")
  .version(packageJson.version)
  .addHelpText(
    "after",
    `
${chalk.gray("Examples:")}
  $ pnpm-lock-buddy list express
  $ pnpm-lock-buddy list express@4.18.2 --exact
  $ pnpm-lock-buddy list @types/node --output json
  $ pnpm-lock-buddy duplicates
  $ pnpm-lock-buddy duplicates --all --output json

${chalk.gray("Environment Variables:")}
  PNPM_LOCK_PATH    Default path to pnpm-lock.yaml file
`,
  );

// Add commands
program.addCommand(createListCommand());
program.addCommand(createDuplicatesCommand());

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
