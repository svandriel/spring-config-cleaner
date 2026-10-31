# spring-config-cleaner

Cleans Spring configuration YAML files.

## Requirements

- Node.js 24.22.1 or newer on the 24.x line (patched for CVE-2026-111497)

## Install

```sh
pnpm add spring-config-cleaner
```

## Usage

### CLI

```sh
# Check (default mode): print a report, exit 1 when duplicates or errors
spring-config-cleaner [dir]

# Fix: rewrite the profile files, removing duplicate entries
spring-config-cleaner --fix [dir]

# Preview a fix without writing anything
spring-config-cleaner --fix --dry-run [dir]
```

Options:

- `--check` — report duplicates without writing (default mode; mutually exclusive with `--fix`)
- `--fix` — remove the duplicate entries from the profile files
- `--dry-run` — compute the fix but never write (requires `--fix`)
- `--style <kebab|camel|snake|preserve>` — key style for surviving keys (default `kebab`)
- `--structure <preserve|nested|dotted>` — layout of the rewritten files (default `preserve`)

### Library

```ts
import { checkConfigs, fixConfigs } from "spring-config-cleaner";

const check = await checkConfigs("./src/main/resources");
console.log(check.duplicates, check.files);

await fixConfigs("./src/main/resources", {
  style: "kebab",
  structure: "dotted",
  dryRun: false,
});
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- `pnpm test:watch` runs Vitest in watch mode.
- `pnpm coverage` writes a coverage report to `coverage/`.
- `pnpm lint:fix` applies Biome lint and format fixes.

## License

MIT
