import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
const rootManifestPath = path.join(rootDir, "manifest.json");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: {
    background: path.join(rootDir, "src", "background.ts"),
    content: path.join(rootDir, "src", "content.ts"),
    popup: path.join(rootDir, "src", "popup.ts")
  },
  bundle: true,
  format: "iife",
  outdir: distDir,
  target: "chrome120",
  sourcemap: false,
  logLevel: "info"
});

await cp(publicDir, distDir, { recursive: true });

const distManifest = JSON.parse(
  await readFile(path.join(distDir, "manifest.json"), "utf8")
);

const rootManifest = {
  ...distManifest,
  background: {
    service_worker: "dist/background.js"
  },
  action: {
    ...distManifest.action,
    default_popup: "dist/popup.html"
  },
  content_scripts: distManifest.content_scripts.map((entry) => ({
    ...entry,
    js: entry.js.map((file) => `dist/${file}`)
  }))
};

await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`, "utf8");
