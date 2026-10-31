import { execSync } from "node:child_process";

/**
 * Build once before any suite runs: the e2e tests drive `dist/cli.js`, and CI
 * runs tests before the separate build step.
 */
export default function setup(): void {
  execSync("pnpm build", { stdio: "inherit" });
}
