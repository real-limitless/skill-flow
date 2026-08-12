#!/usr/bin/env tsx
/**
 * Seed curated skills into catalog/entries + rebuild index.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryFromLocalPackage } from "../../src/catalog/from-package.js";
import { rebuildIndex, writeEntry } from "../../src/catalog/shard.js";
import { loadLocalSkill } from "../../src/package/load-local.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const catalogDir = join(root, "catalog");
const seedDir = join(catalogDir, "seed");

interface SeedDef {
  name: string;
  description: string;
  body: string;
  tags: string[];
  categories: string[];
  files?: Record<string, string>;
}

const SEEDS: SeedDef[] = [
  {
    name: "hello-skill",
    description:
      "Minimal example skill for skill-flow demos. Use when testing skill install or verifying harness discovery.",
    body: `# Hello Skill

When this skill is loaded, greet the user and confirm the skill-flow install path worked.

## Steps

1. Say hello and name this skill (\`hello-skill\`).
2. Report that progressive disclosure loaded SKILL.md successfully.
3. Stop unless the user asks for more.
`,
    tags: ["example", "demo"],
    categories: ["meta"],
  },
  {
    name: "git-commit-helper",
    description:
      "Draft conventional commit messages from staged diffs. Use when the user asks for a commit message, conventional commits, or help committing.",
    body: `# Git Commit Helper

## Steps

1. Run \`git status\` and \`git diff --staged\` (fallback to unstaged if empty).
2. Summarize intent in one sentence.
3. Propose a conventional commit subject (type(scope): summary) ≤72 chars.
4. Optional body with bullets; no secrets or tokens.
5. Do not commit unless the user explicitly asks.
`,
    tags: ["git", "commit"],
    categories: ["developer-tools"],
  },
  {
    name: "pr-description",
    description:
      "Write clear pull request titles and descriptions from branch diffs. Use when opening a PR, drafting PR body, or summarizing changes for review.",
    body: `# PR Description

## Steps

1. Inspect \`git log\` / \`git diff\` against the base branch.
2. Draft title + summary + test plan.
3. Call out breaking changes and migrations.
4. Keep language neutral and scannable.
`,
    tags: ["git", "github", "pr"],
    categories: ["developer-tools"],
  },
  {
    name: "security-review-lite",
    description:
      "Lightweight security review checklist for code changes. Use when reviewing PRs for auth, injection, secrets, or unsafe defaults.",
    body: `# Security Review Lite

## Checklist

- Secrets or credentials in diff?
- Injection (SQL/command/path) risks?
- AuthZ missing on new endpoints?
- Unsafe deserialization or SSRF?
- Dependency/supply-chain red flags?

Report findings with severity and file references. Do not claim a full audit.
`,
    tags: ["security", "review"],
    categories: ["security"],
    files: {
      "references/checklist.md": `# Extended checklist\n\n- XSS\n- CSRF\n- IDOR\n- SSRF\n`,
    },
  },
  {
    name: "docs-outline",
    description:
      "Produce structured documentation outlines (README, ADRs, runbooks). Use when the user wants docs structure, README scaffold, or ADR outline.",
    body: `# Docs Outline

## Steps

1. Clarify audience and doc type.
2. Propose H2/H3 outline only first.
3. After approval, expand sections with concise prose.
4. Prefer examples over theory.
`,
    tags: ["docs", "writing"],
    categories: ["documentation"],
  },
];

async function writeSeedTree(def: SeedDef): Promise<string> {
  const dir = join(seedDir, def.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const fm = `---
name: ${def.name}
description: ${JSON.stringify(def.description)}
license: Apache-2.0
metadata:
  author: skill-flow
  provenance: seed
---

${def.body}`;
  await writeFile(join(dir, "SKILL.md"), fm, "utf8");
  if (def.files) {
    for (const [rel, content] of Object.entries(def.files)) {
      const full = join(dir, rel);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, "utf8");
    }
  }
  return dir;
}

async function main() {
  await mkdir(seedDir, { recursive: true });
  await mkdir(join(catalogDir, "entries"), { recursive: true });

  for (const def of SEEDS) {
    const dir = await writeSeedTree(def);
    const pkg = await loadLocalSkill(dir);
    // keep seed path stable under catalog/seed
    const entry = await entryFromLocalPackage(pkg, {
      id: `seed:${def.name}`,
      provenance: "seed",
      tags: def.tags,
      categories: def.categories,
      sourceUrl: dir,
    });
    // package.localPath should be the seed path relative-friendly absolute
    entry.package.localPath = dir;
    await writeEntry(catalogDir, entry);
    console.log(`seeded ${entry.id}`);
  }

  const index = await rebuildIndex(catalogDir);
  console.log(`index: ${index.entries.length} entries`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
