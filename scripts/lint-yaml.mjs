import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseAllDocuments } from "yaml";

const SKIPPED = new Set(["node_modules", "dist", "coverage", ".git"]);
const YAML_RE = /\.ya?ml$/u;
const errors = [];

// Optional CLI args: directories to walk, and/or individual *.yml/*.yaml
// files to lint directly (e.g. paths passed by lint-staged). No args at all
// walks the current directory (".").
const args = process.argv.slice(2);
const roots = args.length > 0 ? args : ["."];

function lintFile(file) {
  return readFile(file, "utf8").then((contents) => {
    for (const doc of parseAllDocuments(contents)) {
      for (const error of doc.errors) {
        errors.push(`${relative(".", file)}: ${error.message.split("\n")[0]}`);
      }
    }
  });
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // do not descend into gitignored/process-doc trees
      if (join(dir, entry.name) === join(".", "docs/superpowers")) continue;
      if (SKIPPED.has(entry.name)) continue;
      await walk(join(dir, entry.name));
    } else if (entry.isFile() && YAML_RE.test(entry.name)) {
      await lintFile(join(dir, entry.name));
    }
  }
}

for (const root of roots) {
  const rootStat = await stat(root);
  if (rootStat.isFile() && YAML_RE.test(root)) {
    await lintFile(root);
  } else if (rootStat.isDirectory()) {
    await walk(root);
  } else {
    console.error(`lint-yaml: cannot lint non-YAML root "${root}"`);
    process.exit(1);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}
