import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { ParsedSkillMd, SkillFrontmatter } from "../types.js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSkillName(name: string): string[] {
  const warnings: string[] = [];
  if (!name) {
    warnings.push("name is empty");
    return warnings;
  }
  if (name.length > 64) warnings.push("name exceeds 64 characters");
  if (!NAME_RE.test(name)) {
    warnings.push(
      "name should be lowercase alphanumeric with single hyphens (agentskills spec)",
    );
  }
  return warnings;
}

export function parseSkillMd(raw: string): ParsedSkillMd {
  const warnings: string[] = [];
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter (---)");
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter closing --- not found");
  }
  const yamlBlock = text.slice(3, end).replace(/^\r?\n/, "");
  const body = text.slice(end + 4).replace(/^\r?\n/, "");

  let data: Record<string, unknown>;
  try {
    data = (YAML.parse(yamlBlock) ?? {}) as Record<string, unknown>;
  } catch (err) {
    // Retry with description quoted if colon broke YAML
    try {
      const fixed = yamlBlock.replace(
        /^description:\s*(.+)$/m,
        (_m, v: string) => {
          const t = String(v).trim();
          if (
            (t.startsWith('"') && t.endsWith('"')) ||
            (t.startsWith("'") && t.endsWith("'")) ||
            t.startsWith("|") ||
            t.startsWith(">")
          ) {
            return `description: ${t}`;
          }
          return `description: ${JSON.stringify(t)}`;
        },
      );
      data = (YAML.parse(fixed) ?? {}) as Record<string, unknown>;
      warnings.push("frontmatter YAML required lenient parse (unquoted colon)");
    } catch {
      throw new Error(
        `SKILL.md frontmatter YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const name = String(data.name ?? "").trim();
  const description = String(data.description ?? "").trim();
  if (!name) throw new Error("SKILL.md frontmatter missing required field: name");
  if (!description) {
    throw new Error("SKILL.md frontmatter missing required field: description");
  }
  if (description.length > 1024) {
    warnings.push("description exceeds 1024 characters");
  }
  warnings.push(...validateSkillName(name));

  const known = new Set([
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    "allowedTools",
  ]);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!known.has(k)) extra[k] = v;
  }

  let metadata: Record<string, string> | undefined;
  if (data.metadata && typeof data.metadata === "object" && data.metadata) {
    metadata = {};
    for (const [k, v] of Object.entries(data.metadata as Record<string, unknown>)) {
      metadata[k] = String(v ?? "");
    }
  }

  const allowedTools =
    data["allowed-tools"] != null
      ? String(data["allowed-tools"])
      : data.allowedTools != null
        ? String(data.allowedTools)
        : undefined;

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    license: data.license != null ? String(data.license) : undefined,
    compatibility:
      data.compatibility != null ? String(data.compatibility) : undefined,
    metadata,
    allowedTools,
    extra: Object.keys(extra).length ? extra : undefined,
  };

  return { frontmatter, body, raw: text, warnings };
}

export async function parseSkillMdFile(path: string): Promise<ParsedSkillMd> {
  const raw = await readFile(path, "utf8");
  return parseSkillMd(raw);
}
