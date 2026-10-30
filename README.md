# spring-config-cleaner

Cleans Spring configuration YAML files.

## Requirements

- Node.js 24.22.1 or newer on the 24.x line (patched for CVE-2026-111497)

## Install

```sh
pnpm add spring-config-cleaner
```

## Usage

```ts
import { hello, uppercase } from "spring-config-cleaner";

hello("World"); // "Hello, World!"
uppercase("spring"); // "SPRING"
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
