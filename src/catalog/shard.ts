import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CATALOG_SCHEMA_VERSION } from "./constants.js";
import type {
  CatalogIndex,
  CatalogIndexEntry,
  CatalogMeta,
  SkillGalleryEntry,
} from "../types.js";

export function entryFilename(id: string): string {
  return (
    id
      .replace(/\\/g, "/")
      .replace(/\//g, "--")
      .replace(/:/g, "__")
      .replace(/[^a-zA-Z0-9._@+-]+/g, "_")
      .slice(0, 200) + ".json"
  );
}

export function entriesDir(catalogDir: string): string {
  return join(catalogDir, "entries");
}

export async function writeEntry(
  catalogDir: string,
  entry: SkillGalleryEntry,
): Promise<string> {
  const dir = entriesDir(catalogDir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, entryFilename(entry.id));
  await writeFile(file, JSON.stringify(entry, null, 2) + "\n", "utf8");
  return file;
}

export async function readEntry(
  catalogDir: string,
  id: string,
): Promise<SkillGalleryEntry | null> {
  const file = join(entriesDir(catalogDir), entryFilename(id));
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as SkillGalleryEntry;
  } catch {
    // try scan by id field
    return findEntryById(catalogDir, id);
  }
}

async function findEntryById(
  catalogDir: string,
  id: string,
): Promise<SkillGalleryEntry | null> {
  const dir = entriesDir(catalogDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, f), "utf8");
      const entry = JSON.parse(raw) as SkillGalleryEntry;
      if (entry.id === id || entry.name === id) return entry;
    } catch {
      // skip
    }
  }
  return null;
}

export async function listEntries(
  catalogDir: string,
): Promise<SkillGalleryEntry[]> {
  const dir = entriesDir(catalogDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: SkillGalleryEntry[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, f), "utf8");
      out.push(JSON.parse(raw) as SkillGalleryEntry);
    } catch {
      // skip bad
    }
  }
  return out;
}

export function toIndexEntry(e: SkillGalleryEntry): CatalogIndexEntry {
  return {
    id: e.id,
    name: e.name,
    summary: e.summary || e.description.slice(0, 160),
    description: e.description,
    tags: e.tags ?? [],
    categories: e.categories ?? [],
    status: e.status,
    risk: e.security?.risk,
    provenance: e.provenance,
    sourceUrl: e.source?.url,
  };
}

export async function rebuildIndex(catalogDir: string): Promise<CatalogIndex> {
  const entries = await listEntries(catalogDir);
  const index: CatalogIndex = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    entries: entries.map(toIndexEntry).sort((a, b) => a.name.localeCompare(b.name)),
  };
  await mkdir(catalogDir, { recursive: true });
  await writeFile(
    join(catalogDir, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
    "utf8",
  );
  const meta: CatalogMeta = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: index.generatedAt,
    count: index.entries.length,
    source: "skill-flow",
  };
  await writeFile(
    join(catalogDir, "meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8",
  );
  return index;
}

export async function loadIndex(catalogDir: string): Promise<CatalogIndex> {
  try {
    const raw = await readFile(join(catalogDir, "index.json"), "utf8");
    return JSON.parse(raw) as CatalogIndex;
  } catch {
    return rebuildIndex(catalogDir);
  }
}

export function searchIndex(
  index: CatalogIndex,
  query: string,
  limit = 20,
): CatalogIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.entries.slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = index.entries
    .map((e) => {
      const hay = [
        e.id,
        e.name,
        e.summary,
        e.description,
        e.tags.join(" "),
        e.categories.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (e.name === t) score += 100;
        else if (e.name.includes(t)) score += 40;
        else if (hay.includes(t)) score += 10;
        else return { e, score: -1 };
      }
      return { e, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((x) => x.e);
}
