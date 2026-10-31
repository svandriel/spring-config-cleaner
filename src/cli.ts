#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { checkConfigs, type FixOptions, fixConfigs } from "./index.ts";
import type { KeyStyle } from "./keys.ts";
import { renderReport } from "./report.ts";
import type { Structure } from "./rewrite.ts";

const STYLES: readonly string[] = ["kebab", "camel", "snake", "preserve"];
const STRUCTURES: readonly string[] = ["preserve", "nested", "dotted"];

/** Parsed option shape of the program (every option carries a default). */
interface Options {
  fix: boolean;
  dryRun: boolean;
  style: KeyStyle;
  structure: Structure;
}

/**
 * Run the program against `argv` (user arguments, no node/executable prefix)
 * and resolve to its exit code: 0 for help/version and clean runs, 1 for
 * duplicates (check mode), per-file errors, option misuse, or validation
 * failures. A fresh commander program is built per call (no module state), so
 * repeated invocations never leak options. Option errors, conflicts and
 * `--help` are surfaced through commander's own stderr messages via
 * `.exitOverride()`, mapped here to their suggested `exitCode`; `runCli`
 * itself never calls `process.exit`.
 */
export async function runCli(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("spring-config-cleaner")
    .description("Check and fix duplicate keys in Spring application profile configs.")
    .version("0.0.0")
    .exitOverride()
    .argument("[dir]", "config directory to process", process.cwd())
    .option("--fix", "rewrite the profile files, removing duplicates", false)
    .addOption(
      new Option("--check", "report duplicates without writing (default)").conflicts("fix"),
    )
    .option("--dry-run", "compute the fix but never write (requires --fix)", false)
    .addOption(
      new Option("--style <style>", "key style for surviving keys")
        .choices(STYLES)
        .default("kebab"),
    )
    .addOption(
      new Option("--structure <structure>", "layout of rewritten files")
        .choices(STRUCTURES)
        .default("preserve"),
    )
    .allowExcessArguments(false);

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    return err instanceof CommanderError ? err.exitCode : 1;
  }

  const { fix, dryRun, style, structure } = program.opts<Options>();
  if (dryRun && !fix) {
    console.error("error: --dry-run requires --fix");
    return 1;
  }

  // Argument defaults live in processedArgs (not opts); the commander-declared
  // default is process.cwd().
  const [dirArg] = program.processedArgs;
  const dir = typeof dirArg === "string" ? dirArg : process.cwd();

  const options: FixOptions = { style, structure, dryRun };
  const result = fix ? await fixConfigs(dir, options) : await checkConfigs(dir);
  process.stdout.write(renderReport(result.files, fix && dryRun));
  const errored = result.files.some((file) => file.error !== undefined);
  return errored || (!fix && result.duplicates > 0) ? 1 : 0;
}

/** True when this module is the node entry (`node dist/cli.js`, bin symlinks included). */
function isMainModule(): boolean {
  const main = process.argv[1];
  if (main === undefined) {
    return false;
  }
  // realpath comparison keeps the guard true through the installed bin symlink.
  return realpathSync(main) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
