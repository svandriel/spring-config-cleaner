# AGENTS.md

CLI/library (TypeScript, ESM, Node 24) for cleaning Spring config YAML files. Currently placeholder scaffold exports (`hello`, `uppercase` in `src/`) — the dedupe CLI work happens on feature branches off the design in `docs/superpowers/specs/` (see Workflow rules).

## Commands

CI order is required: `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build`.

- Setup: `pnpm install` (CI uses `--frozen-lockfile` — commit lockfile changes)
- Typecheck all three project references: `pnpm typecheck`
- All tests: `pnpm test` · watch: `pnpm test:watch` · coverage: `pnpm coverage`
- Single test file: `pnpm exec vitest run src/hello.spec.ts`
- Build to `dist/`: `pnpm build` (runs `tsc -b tsconfig.app.json`)
- Lint + format fix: `pnpm lint:fix` (Biome; no ESLint/Prettier — don't run both ecosystems)

## Environment (strict, refuses to run otherwise)

- Node **24.x only**, ≥ 24.22.1: `.nvmrc` pins `24.22.1`, `package.json` `engines`/`devEngines` cap `<25`, `.npmrc` sets `engine-strict=true`. A CVE-patched 24.22.1+ is a security requirement (CVE-2026-111497), not a preference.
- pnpm via Corepack: `packageManager` field pins `pnpm@12.4.1`.

## TypeScript strictness quirks (code fails review without these)

- Imports of local files include the `.ts` extension (`./hello.ts`) — `rewriteRelativeImportExtensions` rewrites them at build time. Use it, don't drop the extension.
- `verbatimModuleSyntax`: type-only imports must be `import type { X } from ...`.
- `erasableSyntaxOnly`: no enums, namespaces, or constructor parameter properties.
- `noUncheckedIndexedAccess`: index access returns `T | undefined` — guard it.
- `exactOptionalPropertyTypes` / `noPropertyAccessFromIndexSignature`: `obj.key?.foo` optional-prop assignment and `obj["dot.key"]`-via-dot both error.
- Project layout: `tsconfig.app.json` compiles `src` → `dist` (excludes `*.spec.ts`); `tsconfig.spec.json` typechecks tests (noEmit); `tsconfig.node.json` covers `vitest.config.ts`. Never add `src` test files to the app project.
- Only `dist/` is published (`files` field); source imports in `package.json` resolve to `dist`, so verify `pnpm build` passes before publishing anything.

## Formatting & style (Biome 2.6, enforced)

Double quotes, semicolons, 100-wide, 2-space indent, trailing commas `all`. Biome's `vcs` setting means ignored paths (`dist`, `coverage`) are skipped automatically.

## Iteration style

Avoid `for`/`while` loops whenever possible — prefer functional iteration (`map`, `reduce`, `filter`, `find`, `flatMap`, `some`/`every`, etc.). Use a loop only when functional form genuinely doesn't fit (e.g. early-exit-heavy parsers where a loop is materially clearer).

## Workflow rules

- Always work in feature branches off `main`. Main branch is locked, PR's only.
- Prefer git worktrees, but ask user first
- Never commit anything under `docs/superpowers/` — process/design documents stay local and untracked (enforced by `.gitignore`).
- Tests are colocated `*.spec.ts`/`*.test.ts` files under `src/`; fixtures go beside the spec that uses them.
