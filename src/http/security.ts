import { createHash } from "node:crypto";
import type { Context } from "hono";

/** sha256 hashes of inline scripts, matching what a browser hashes. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    if (!body) continue;
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

export function contentSecurityPolicy(indexHtml: string | null): string {
  const hashes = indexHtml ? inlineScriptHashes(indexHtml) : [];
  const scriptSrc = ["'self'", ...hashes].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

export function trustedProxy(): boolean {
  return process.env.SKILL_FLOW_TRUSTED_PROXY === "true";
}

export function requestIsHttps(c: Context): boolean {
  try {
    if (new URL(c.req.url).protocol === "https:") return true;
  } catch {
    /* ignore a malformed URL */
  }
  if (!trustedProxy()) return false;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

export function corsAllowlist(): string[] {
  return (process.env.SKILL_FLOW_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Host header when the client sent one, otherwise the host of the request URL. */
export function requestHost(headerHost: string | undefined, url: string): string {
  const trimmed = headerHost?.trim();
  if (trimmed) return trimmed;
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Same-origin, or an origin listed in SKILL_FLOW_CORS_ORIGINS. Never `*`. */
export function allowedCorsOrigin(origin: string, host: string): string | null {
  if (!origin) return null;
  if (corsAllowlist().includes(origin)) return origin;
  try {
    if (new URL(origin).host === host) return origin;
  } catch {
    return null;
  }
  return null;
}
