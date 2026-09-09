import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { entryFromLocalPackage } from "../src/catalog/from-package.js";
import {
  addEntry,
  rebuildIndex,
  searchIndex,
  writeEntry,
  readEntry,
} from "../src/catalog/shard.js";
import { loadLocalSkill } from "../src/package/load-local.js";
import { writeMinimalSkill } from "../src/package/resolve-source.js";

const temps: string[] = [];
afterEach(async () => {
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

describe("catalog shards", () => {
  it("writes entry and searches index", async () => {
    const catalogDir = await mkdtemp(join(tmpdir(), "sf-cat-"));
    const skillDir = await mkdtemp(join(tmpdir(), "sf-sk-"));
    temps.push(catalogDir, skillDir);
    await writeMinimalSkill(
      skillDir,
      "search-me-skill",
      "Findable skill about purple widgets and linting.",
    );
    const pkg = await loadLocalSkill(skillDir);
    const entry = await entryFromLocalPackage(pkg, {
      id: "seed:search-me-skill",
      provenance: "seed",
      tags: ["widgets"],
    });
    await writeEntry(catalogDir, entry);
    const index = await rebuildIndex(catalogDir);
    expect(index.entries.length).toBe(1);
    const hits = searchIndex(index, "purple widgets");
    expect(hits[0]?.name).toBe("search-me-skill");
    const again = await readEntry(catalogDir, "seed:search-me-skill");
    expect(again?.name).toBe("search-me-skill");
  });

  it("refuses to overwrite the same id without force", async () => {
    const catalogDir = await mkdtemp(join(tmpdir(), "sf-cat-"));
    const skillDir = await mkdtemp(join(tmpdir(), "sf-sk-"));
    temps.push(catalogDir, skillDir);
    await writeMinimalSkill(skillDir, "dup-skill", "Duplicate catalog add test.");
    const pkg = await loadLocalSkill(skillDir);
    const entry = await entryFromLocalPackage(pkg, { id: "local:hello-dup" });
    await addEntry(catalogDir, entry);
    await expect(addEntry(catalogDir, entry)).rejects.toThrow(/already exists/);
    await addEntry(catalogDir, entry, { force: true });
    const again = await readEntry(catalogDir, "local:hello-dup");
    expect(again?.id).toBe("local:hello-dup");
  });

  it("stores repo-relative localPath for in-tree skills", async () => {
    const seed = join(process.cwd(), "catalog", "seed", "hello-skill");
    const pkg = await loadLocalSkill(seed);
    const entry = await entryFromLocalPackage(pkg, {
      id: "seed:hello-skill",
      sourceUrl: "catalog/seed/hello-skill",
    });
    expect(entry.package.localPath).toBe("catalog/seed/hello-skill");
    expect(entry.source.url).toBe("catalog/seed/hello-skill");
    expect(entry.package.localPath).not.toMatch(/^\/home\//);
  });
});
