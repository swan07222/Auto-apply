import { rmSync } from "node:fs";

const paths = [
  "coverage",
  "playwright-report",
  "test-results",
  "reports",
  "artifacts",
];

for (const target of paths) {
  rmSync(target, {
    recursive: true,
    force: true,
  });
}

console.log(`Cleaned ${paths.length} generated path${paths.length === 1 ? "" : "s"}.`);
