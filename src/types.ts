export type InstallScope = "user" | "project";

export type InstallMode = "copy" | "symlink";

export type InstallTarget =
  | "portable"
  | "detected"
  | `harness:${string}`
  | "generic";

export type SkillStatus =
  | "active"
  | "deprecated"
  | "inactive"
  | "unknown";

export type SkillProvenance = "factory" | "manual" | "seed";

export type SkillRisk = "low" | "medium" | "high" | "unknown";

export type SourceKind = "github" | "gitlab" | "url" | "local";

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  /** Extra keys preserved from YAML */
  extra?: Record<string, unknown>;
}

export interface ParsedSkillMd {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
  warnings: string[];
}

export interface SkillPackageInfo {
  root: string;
  name: string;
  skillMdPath: string;
  files: string[];
  parsed: ParsedSkillMd;
}

export interface HarnessPaths {
  user?: string;
  project?: string;
}

export interface HarnessAdapter {
  id: string;
  displayName: string;
  paths: HarnessPaths;
  /** Relative project path under project root */
  projectRel?: string;
  /** Relative user path under home (with ~ expanded at runtime) */
  installMode: "dir" | "zip" | "unsupported";
  notes?: string;
}

export interface DetectedHarness {
  id: string;
  displayName: string;
  present: boolean;
  userRoot?: string;
  projectRoot?: string;
  installMode: HarnessAdapter["installMode"];
  notes?: string;
}

export interface InstallRequest {
  /** Gallery id, local path, or git/https URL */
  source: string;
  target?: InstallTarget;
  scope?: InstallScope;
  mode?: InstallMode;
  force?: boolean;
  confirm?: boolean;
  projectRoot?: string;
  /** For target=generic */
  genericPath?: string;
  /** Optional harness id when target is harness: */
  harnessId?: string;
}

export interface InstallResult {
  name: string;
  source: string;
  paths: string[];
  mode: InstallMode;
  warnings: string[];
  audit: AuditReport;
}

export interface InstalledSkill {
  name: string;
  path: string;
  harnessId: string;
  scope: InstallScope;
  sourceId?: string;
  sha256?: string;
  installedAt: string;
}

export interface AuditFlag {
  id: string;
  severity: SkillRisk;
  message: string;
}

export interface AuditReport {
  risk: SkillRisk;
  flags: AuditFlag[];
  hasScripts: boolean;
  fileCount: number;
  externalUrls: string[];
}

export interface SkillSource {
  kind: SourceKind;
  url: string;
  ref?: string;
  subpath?: string;
  skillPath: string;
}

export interface SkillPackageRef {
  kind: "git-subtree" | "tarball" | "zip" | "local-path";
  url?: string;
  localPath?: string;
  sha256?: string;
  sizeBytes?: number;
  files?: string[];
}

export interface SkillGalleryEntry {
  schemaVersion: string;
  id: string;
  name: string;
  title?: string;
  description: string;
  summary?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  categories: string[];
  tags: string[];
  status: SkillStatus;
  provenance: SkillProvenance;
  source: SkillSource;
  repository?: {
    url?: string;
    host?: string;
    stars?: number;
    defaultBranch?: string;
  };
  package: SkillPackageRef;
  skillMd: {
    frontmatter: Record<string, unknown>;
    bodyPreview?: string;
    lineCount?: number;
  };
  security?: {
    risk: SkillRisk;
    flags: string[];
    auditedAt?: string;
  };
  stats?: {
    stars?: number;
    forks?: number;
    updatedAt?: string;
  };
  readme?: {
    markdown?: string;
    source?: string;
    fetchedAt?: string;
  };
  publishedAt?: string;
  updatedAt?: string;
  fetchedAt?: string;
}

export interface CatalogIndexEntry {
  id: string;
  name: string;
  summary: string;
  description: string;
  tags: string[];
  categories: string[];
  status: SkillStatus;
  risk?: SkillRisk;
  provenance: SkillProvenance;
  sourceUrl?: string;
}

export interface CatalogMeta {
  schemaVersion: string;
  generatedAt: string;
  count: number;
  source?: string;
}

export interface CatalogIndex {
  schemaVersion: string;
  generatedAt: string;
  entries: CatalogIndexEntry[];
}
