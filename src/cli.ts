#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, Option } from "commander";
import pkg from "../package.json" with { type: "json" };
import { checkConfigs, fixConfigs } from "./index.ts";
import type { KeyStyle } from "./keys.ts";
import { type Hint, type RenderMode, renderResults } from "./render.ts";
import type { Structure } from "./rewrite.ts";
import { colorEnabled, createStyle, type Style } from "./style.ts";

const STYLES: readonly string[] = ["kebab", "camel", "snake", "preserve"];
const STRUCTURES: readonly string[] = ["preserve", "nested", "dotted"];
const DEFAULT_STYLE = "kebab";
const DEFAULT_STRUCTURE = "preserve";
const COMMAND = "spring-config-cleaner";

/** Parsed option shape of the program (every option carries a default). */
interface Options {
  fix: boolean;
  dryRun: boolean;
  style: KeyStyle;
  structure: Structure;
}

/**
 * Quote one shell word only when it needs it, so the common relative path stays
 * copy-pasteable and spaces survive.
 */
function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** Render the `--help` pointer hint shared by every usage failure. */
function usageHint(style: Style): string {
  return `  Run ${style.command(`${COMMAND} --help`)} for usage.`;
}

/** A directory word that stays an argument even when it starts with `-`. */
function directoryWord(dir: string): string {
  const quoted = shellQuote(dir);
  return dir.startsWith("-") ? `-- ${quoted}` : quoted;
}

/** The command that performs `flags`, preserving explicit non-default rewrite options. */
function commandFor(flags: string[], dir: string, options: Options): string {
  const rewritten = [
    ...flags,
    ...(options.style === DEFAULT_STYLE ? [] : ["--style", options.style]),
    ...(options.structure === DEFAULT_STRUCTURE ? [] : ["--structure", options.structure]),
    directoryWord(dir),
  ];
  return [COMMAND, ...rewritten].join(" ");
}

/** Mode- and outcome-specific next steps; empty when there is nothing to act on. */
function hintsFor(mode: RenderMode, duplicates: number, dir: string, options: Options): Hint[] {
  if (duplicates === 0) {
    return [];
  }
  if (mode === "check") {
    return [
      { label: "Remove them:", command: commandFor(["--fix"], dir, options) },
      {
        label: "Preview first:",
        command: commandFor(["--fix", "--dry-run"], dir, options),
      },
    ];
  }
  if (mode === "dry-run") {
    return [{ label: "Apply:", command: commandFor(["--fix"], dir, options) }];
  }
  return [{ label: "Verify:", command: commandFor(["--check"], dir, options) }];
}

/**
 * Run the program against `argv` (user arguments, no node/executable prefix)
 * and resolve to its exit code: 0 for help/version and clean runs, 1 for
 * duplicates (check mode), per-file errors, option misuse, or validation
 * failures. A fresh commander program is built per call (no module state), so
 * repeated invocations never leak options. Option errors, conflicts and
 * `--help` are surfaced through commander's own messages via
 * `.exitOverride()`, mapped here to their suggested `exitCode`; `runCli`
 * itself never calls `process.exit`.
 */
export async function runCli(argv: string[]): Promise<number> {
  const stdoutStyle = createStyle(colorEnabled(process.stdout));
  const stderrStyle = createStyle(colorEnabled(process.stderr));

  const program = new Command();
  program
    .name(COMMAND)
    .description("Check and fix duplicate keys in Spring application profile configs.")
    .version(pkg.version)
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
        .default(DEFAULT_STYLE),
    )
    .addOption(
      new Option("--structure <structure>", "layout of rewritten files")
        .choices(STRUCTURES)
        .default(DEFAULT_STRUCTURE),
    )
    .allowExcessArguments(false);

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode !== 0) {
        process.stderr.write(`\n${usageHint(stderrStyle)}\n`);
      }
      return err.exitCode;
    }
    return 1;
  }

  const options: Options = program.opts<Options>();
  if (options.dryRun && !options.fix) {
    process.stderr.write(
      `${stderrStyle.error("✖")} ${stderrStyle.error("--dry-run requires --fix")}\n` +
        `\n${usageHint(stderrStyle)}\n`,
    );
    return 1;
  }

  // Argument defaults live in processedArgs (not opts); the commander-declared
  // default is process.cwd().
  const [dirArg] = program.processedArgs;
  const dir = typeof dirArg === "string" ? dirArg : process.cwd();
  const mode: RenderMode = options.fix ? (options.dryRun ? "dry-run" : "fix") : "check";

  const result = options.fix
    ? await fixConfigs(dir, {
        style: options.style,
        structure: options.structure,
        dryRun: options.dryRun,
      })
    : await checkConfigs(dir);
  process.stdout.write(
    renderResults(result.files, {
      mode,
      style: stdoutStyle,
      hints: hintsFor(mode, result.duplicates, dir, options),
    }),
  );
  const errored = result.files.some((file) => file.error !== undefined);
  return errored || (!options.fix && result.duplicates > 0) ? 1 : 0;
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
