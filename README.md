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

### Output

Findings are diagnostics: a file header with a clickable `line:column` for each
finding, the offending source line with a caret run under the redundant entry,
and the base location that already defines the same value. Error headers include
the full `path:line:column`.

```text
/srv/app/config/application-prod.yml
  2:1  duplicate  my.app.maxThreads = 8
  2 │ my.app.maxThreads: 8
    │ ^^^^^^^^^^^^^^^^^^^^  already defined in /srv/app/config/application.yml:7:5

✖ 2 duplicates in 2 of 2 profile files

  Remove them:    spring-config-cleaner --fix /srv/app/config
  Preview first:  spring-config-cleaner --fix --dry-run /srv/app/config
```

`--fix --dry-run` keeps the frames and marks each entry `(would remove)`;
`--fix` prints the entries it removed and how to verify:

```text
✓ /srv/app/config/application-prod.yml  removed 1 duplicate
  − my.app.maxThreads = 8

✓ Removed 2 duplicates from 2 files.

  Verify:  spring-config-cleaner --check /srv/app/config
```

YAML parse errors show the failing position and a frame; a clean run prints a
single green checkmark. Colour is applied only when the destination is a
colour-capable terminal, so piped and CI output stays plain text. `FORCE_COLOR`
overrides that check, while `NO_COLOR`, `TERM=dumb` and non-TTY destinations
keep the output plain.

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
