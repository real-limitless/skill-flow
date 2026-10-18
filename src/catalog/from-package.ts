import { CATALOG_SCHEMA_VERSION } from "./constants.js";
import { auditPackage, auditReportToSecurity } from "../audit/scan.js";
import { toRepoRelativePath } from "../paths.js";
import type { SkillGalleryEntry, SkillPackageInfo, SkillProvenance } from "../types.js";

export async function entryFromLocalPackage(
  pkg: SkillPackageInfo,
  opts: {
    id?: string;
    provenance?: SkillProvenance;
    categories?: string[];
    tags?: string[];
    sourceUrl?: string;
  } = {},
): Promise<SkillGalleryEntry> {
  const audit = await auditPackage(pkg);
  const fm = pkg.parsed.frontmatter;
  const id =
    opts.id ??
    `local:${fm.name}`;
  const bodyPreview = pkg.parsed.body.slice(0, 2000);
  const lineCount = pkg.parsed.body.split(/\r?\n/).length;

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id,
    name: fm.name,
    title: fm.name,
    description: fm.description,
    summary: fm.description.slice(0, 160),
    license: fm.license,
    compatibility: fm.compatibility,
    metadata: fm.metadata,
    allowedTools: fm.allowedTools,
    categories: opts.categories ?? [],
    tags: opts.tags ?? [],
    status: "active",
    provenance: opts.provenance ?? "manual",
    source: {
      kind: "local",
      url: opts.sourceUrl ?? toRepoRelativePath(pkg.root),
      skillPath: "SKILL.md",
    },
    package: {
      kind: "local-path",
      localPath: toRepoRelativePath(pkg.root),
      files: pkg.files,
    },
    skillMd: {
      frontmatter: {
        name: fm.name,
        description: fm.description,
        license: fm.license,
        compatibility: fm.compatibility,
        metadata: fm.metadata,
        "allowed-tools": fm.allowedTools,
      },
      bodyPreview,
      lineCount,
    },
    security: auditReportToSecurity(audit),
    fetchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
