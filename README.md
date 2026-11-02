# spring-config-cleaner

Find and remove duplicate entries in Spring profile YAML while keeping the
configuration's effective values unchanged. Check or fix files from the CLI,
preview changes before writing, or use the TypeScript API in your own tools.

## Requirements

- Node.js 24 or newer

## Install

```sh
pnpm add spring-config-cleaner
```

## Usage

### CLI

```sh
# Check (default mode): exit 1 for duplicates, errors, or a requested base format mismatch
spring-config-cleaner [dir]

# Also check that application.yml already matches the selected format
spring-config-cleaner --base [dir]

# Fix: rewrite the profile files, removing duplicate entries
spring-config-cleaner --fix [dir]

# Also rewrite the base application.yml using the selected style and structure
spring-config-cleaner --fix --base --style kebab --structure nested [dir]

# Preview a fix without writing anything
spring-config-cleaner --fix --dry-run [dir]
```

Options:

- `--check` — report duplicates without writing (default mode; mutually exclusive with `--fix`)
- `--fix` — remove the duplicate entries from the profile files
- `--base` — check that `application.yml` already matches the selected style and structure;
  with `--fix`, rewrite it too (omitted by default)
- `--dry-run` — compute the fix but never write (requires `--fix`)
- `--style <kebab|camel|snake|preserve>` — key style for surviving keys (default `preserve`)
- `--structure <preserve|nested|dotted|compact>` — layout of the rewritten files (default `compact`)

`compact` uses dotted keys for single-child paths and keeps branching mappings
nested.

### Output

Findings are grouped under each file path and show a `line:column` location, the
offending source line with a caret under the redundant entry, and the base
location that already defines the same value. Positioned errors include the
full `path:line:column` in their headers.

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
with `--base`, it also reports at the end that `application.yml` would be
updated using the selected style and structure, without writing the file.
`--fix` prints the entries it removed and how to verify:

```text
✓ /srv/app/config/application-prod.yml  removed 1 duplicate
  − my.app.maxThreads = 8

✓ Removed 2 duplicates from 2 files.

  Verify:  spring-config-cleaner --check /srv/app/config
```

YAML parse errors with a known position show the failing position and a source
frame; errors without a position, such as multi-document files, omit the frame.
A clean run prints a single green checkmark. Colour is applied only when the
destination is a colour-capable terminal, so piped and CI output stays plain
text. `FORCE_COLOR` overrides that check, while `NO_COLOR`, `TERM=dumb` and
non-TTY destinations keep the output plain.

### Library

```ts
import { checkConfigs, fixConfigs } from "spring-config-cleaner";

const check = await checkConfigs("./src/main/resources");
console.log(check.duplicates, check.files);

await fixConfigs("./src/main/resources", {
  style: "kebab",
  structure: "dotted",
  base: true,
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
