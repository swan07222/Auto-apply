import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["playwright", "test", ...process.argv.slice(2)];

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    ENABLE_LIVE_TESTS: process.env.ENABLE_LIVE_TESTS || "1",
  },
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
