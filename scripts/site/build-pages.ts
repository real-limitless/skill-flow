#!/usr/bin/env tsx
/**
 * Assemble static GitHub Pages tree:
 *   site/* + catalog/{index,meta,entries,seed} + campaign images → site/out/
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const siteSrc = process.env.SITE_SRC || join(ROOT, "site");
const catalogDir = process.env.CATALOG_DIR || join(ROOT, "catalog");
const outDir = process.env.OUT_DIR || join(ROOT, "site/out");
const base = normalizeBase(process.env.SITE_BASE ?? "/skill-flow");
const repoUrl =
  process.env.SITE_REPO || "https://github.com/real-limitless/skill-flow";

function normalizeBase(b: string): string {
  if (!b || b === "/") return "";
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name === "out") continue;
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else cpSync(s, d);
  }
}

function main(): void {
  if (!existsSync(siteSrc)) throw new Error(`site source missing: ${siteSrc}`);

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const name of readdirSync(siteSrc)) {
    if (name === "out") continue;
    const s = join(siteSrc, name);
    const d = join(outDir, name);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else cpSync(s, d);
  }

  // Catalog
  const catOut = join(outDir, "catalog");
  mkdirSync(catOut, { recursive: true });
  for (const name of ["index.json", "meta.json", "schema.json", "blocklist.txt", "README.md"]) {
    const p = join(catalogDir, name);
    if (existsSync(p)) cpSync(p, join(catOut, name));
  }
  const entries = join(catalogDir, "entries");
  if (existsSync(entries)) copyDir(entries, join(catOut, "entries"));
  const seed = join(catalogDir, "seed");
  if (existsSync(seed)) copyDir(seed, join(catOut, "seed"));

  // Campaign images into site assets for stable Pages URLs
  const imgDir = join(ROOT, "docs/images");
  const assetsOut = join(outDir, "assets");
  mkdirSync(assetsOut, { recursive: true });
  if (existsSync(imgDir)) {
    for (const name of readdirSync(imgDir)) {
      if (name.startsWith("campaign-") && name.endsWith(".png")) {
        cpSync(join(imgDir, name), join(assetsOut, name));
      }
    }
  }

  // Inject config
  const configPath = join(outDir, "assets/config.js");
  writeFileSync(
    configPath,
    `window.__SITE__ = ${JSON.stringify(
      {
        base,
        catalogBase: "catalog",
        repo: repoUrl,
      },
      null,
      2,
    )};\n`,
    "utf8",
  );

  // .nojekyll for GitHub Pages
  writeFileSync(join(outDir, ".nojekyll"), "", "utf8");

  let entryCount = 0;
  try {
    entryCount = readdirSync(join(catOut, "entries")).filter((f) =>
      f.endsWith(".json"),
    ).length;
  } catch {
    entryCount = 0;
  }

  let indexCount = 0;
  try {
    const idx = JSON.parse(readFileSync(join(catOut, "index.json"), "utf8"));
    indexCount = idx.entries?.length ?? 0;
  } catch {
    // no index
  }

  console.log(
    `site:build → ${outDir} (base=${base || "/"} entries=${entryCount} index=${indexCount})`,
  );
}

main();
