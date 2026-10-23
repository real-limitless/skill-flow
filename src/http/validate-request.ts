import { access, lstat, realpath } from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { z } from "zod";
import { expandHome, skillFlowHome } from "../paths.js";
import type { InstallScope, InstallTarget } from "../types.js";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CATALOG_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,199}$/;
const HARNESS_TARGET = /^harness:[a-z0-9][a-z0-9-]{0,63}$/;

export interface InstallBody {
  source: string;
  target?: InstallTarget;
  scope?: InstallScope;
  genericPath?: string;
  subpath?: string;
}

export interface AuditBody {
  source: string;
  subpath?: string;
}

export interface DeleteInstall {
  name: string;
  target?: string;
  genericPath?: string;
}

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

const installSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  target: z.string().trim().min(1).max(80).optional(),
  scope: z.enum(["user", "project"]).optional(),
  genericPath: z.string().trim().min(1).max(4096).optional(),
  subpath: z.string().trim().min(1).max(128).optional(),
});

const auditSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  subpath: z.string().trim().min(1).max(128).optional(),
});

const deleteSchema = z.object({
  name: z.string().trim().min(1).max(64),
  target: z.string().trim().min(1).max(80).optional(),
  genericPath: z.string().trim().min(1).max(4096).optional(),
});

function issue(err: z.ZodError): string {
  const msg = err.issues[0]?.message ?? "invalid request";
  return msg.length > 160 ? "invalid request" : msg;
}

function blankToUndef(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function allowRoots(catalogDir: string): string[] {
  const roots = [skillFlowHome(), catalogDir];
  const extra = process.env.SKILL_FLOW_PATH_ROOTS ?? "";
  for (const part of extra.split(delimiter)) {
    const trimmed = part.trim();
    if (trimmed) roots.push(expandHome(trimmed));
  }
  return [...new Set(roots.map((root) => resolve(expandHome(root))))];
}

/** Single path segment: no separators and no `..`. */
export function isSafeSegment(value: string): boolean {
  if (!value || value.length > 128) return false;
  if (value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return SAFE_SEGMENT.test(value);
}

export function isSafeSkillName(value: string): boolean {
  if (!value || value.length > 64) return false;
  if (value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return SKILL_NAME.test(value);
}

function badControl(value: string): boolean {
  return value.includes("\0") || /%(?:2e|2f|5c)/i.test(value);
}

function hasParentSegment(value: string): boolean {
  return value.split(/[\\/]/).some((segment) => segment === "..");
}

function sourceKind(source: string): "url" | "path" | "id" {
  if (/^(https?|ssh|git|file|ftp):\/\//i.test(source) || /^git@/i.test(source)) return "url";
  if (
    source.startsWith("~") ||
    isAbsolute(source) ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.includes("/") ||
    source.includes("\\")
  ) {
    return "path";
  }
  return "id";
}

export function isHttpsGitUrl(source: string): boolean {
  if (source !== source.trim() || /\s/.test(source) || badControl(source)) return false;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (!url.hostname || url.hostname.includes("..")) return false;
  return true;
}

function isTarget(value: string): value is InstallTarget {
  return value === "portable" || value === "detected" || value === "generic" || HARNESS_TARGET.test(value);
}

async function existsLocal(source: string): Promise<boolean> {
  try {
    await access(resolve(expandHome(source)));
    return true;
  } catch {
    return false;
  }
}

async function canonical(path: string): Promise<string | null> {
  let current = resolve(expandHome(path));
  const suffix: string[] = [];
  for (;;) {
    try {
      await lstat(current);
      const real = await realpath(current);
      return suffix.length ? resolve(real, ...suffix) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

async function rootReal(root: string): Promise<string> {
  const abs = resolve(expandHome(root));
  try {
    return await realpath(abs);
  } catch {
    return abs;
  }
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Allowlisted local path. Symlinks are resolved and must stay inside a root. */
export async function localPathAllowed(
  input: string,
  roots: string[],
  opts: { mustExist: boolean },
): Promise<boolean> {
  if (!input || badControl(input) || hasParentSegment(input)) return false;
  const finalPath = await canonical(input);
  if (!finalPath) return false;
  if (opts.mustExist) {
    try {
      await lstat(finalPath);
    } catch {
      return false;
    }
  }
  for (const root of roots) {
    if (within(await rootReal(root), finalPath)) return true;
  }
  return false;
}

async function checkSource(
  source: string,
  roots: string[],
): Promise<string | null> {
  if (badControl(source)) return "invalid source";
  let kind = sourceKind(source);
  if (kind === "id" && (await existsLocal(source))) kind = "path";
  if (kind === "url") {
    return isHttpsGitUrl(source) ? null : "only https URLs are allowed";
  }
  if (kind === "path") {
    const ok = await localPathAllowed(source, roots, { mustExist: true });
    return ok ? null : "local path is not under an allowed root";
  }
  if (source.includes("..") || !CATALOG_ID.test(source)) return "invalid catalog id";
  return null;
}

export async function parseInstallRequest(
  body: unknown,
  catalogDir: string,
): Promise<Ok<InstallBody> | Err> {
  const parsed = installSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: issue(parsed.error) };
  const value = parsed.data;
  const roots = allowRoots(catalogDir);
  const sourceError = await checkSource(value.source, roots);
  if (sourceError) return { ok: false, error: sourceError };
  if (value.target && !isTarget(value.target)) return { ok: false, error: "invalid target" };
  if (value.subpath && !isSafeSegment(value.subpath)) {
    return { ok: false, error: "subpath must be a single safe path segment" };
  }
  if (value.genericPath) {
    const ok = await localPathAllowed(value.genericPath, roots, { mustExist: false });
    if (!ok) return { ok: false, error: "genericPath is not under an allowed root" };
  }
  return {
    ok: true,
    value: {
      source: value.source,
      target: value.target as InstallTarget | undefined,
      scope: value.scope,
      genericPath: value.genericPath,
      subpath: value.subpath,
    },
  };
}

export async function parseAuditRequest(
  body: unknown,
  catalogDir: string,
): Promise<Ok<AuditBody> | Err> {
  const parsed = auditSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: issue(parsed.error) };
  const value = parsed.data;
  const sourceError = await checkSource(value.source, allowRoots(catalogDir));
  if (sourceError) return { ok: false, error: sourceError };
  if (value.subpath && !isSafeSegment(value.subpath)) {
    return { ok: false, error: "subpath must be a single safe path segment" };
  }
  return { ok: true, value: { source: value.source, subpath: value.subpath } };
}

export async function parseDeleteInstall(
  query: { name?: string; target?: string; genericPath?: string },
  catalogDir: string,
): Promise<Ok<DeleteInstall> | Err> {
  const parsed = deleteSchema.safeParse({
    name: query.name,
    target: blankToUndef(query.target),
    genericPath: blankToUndef(query.genericPath),
  });
  if (!parsed.success) return { ok: false, error: issue(parsed.error) };
  if (!isSafeSkillName(parsed.data.name)) {
    return { ok: false, error: "name must be a safe skill name" };
  }
  if (parsed.data.target && !isTarget(parsed.data.target)) {
    return { ok: false, error: "invalid target" };
  }
  if (parsed.data.genericPath) {
    const ok = await localPathAllowed(parsed.data.genericPath, allowRoots(catalogDir), {
      mustExist: false,
    });
    if (!ok) return { ok: false, error: "genericPath is not under an allowed root" };
  }
  return {
    ok: true,
    value: {
      name: parsed.data.name,
      target: parsed.data.target,
      genericPath: parsed.data.genericPath,
    },
  };
}
