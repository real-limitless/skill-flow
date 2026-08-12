#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { listEntries } from "../../src/catalog/shard.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const catalogDir = process.env.SKILL_FLOW_CATALOG_DIR ?? join(root, "catalog");

async function main() {
  const schema = JSON.parse(
    await readFile(join(catalogDir, "schema.json"), "utf8"),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const entries = await listEntries(catalogDir);
  let bad = 0;
  for (const e of entries) {
    const ok = validate(e);
    if (!ok) {
      bad++;
      console.error(e.id, validate.errors);
    }
  }
  console.log(`validated ${entries.length} entries, ${bad} failed`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
