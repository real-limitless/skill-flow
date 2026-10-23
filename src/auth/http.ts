import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requestHost } from "../http/security.js";

export const SESSION_COOKIE = "sf_op";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

export function readSessionToken(c: Context): string | null {
  const v = getCookie(c, SESSION_COOKIE);
  return v && v.trim() ? v.trim() : null;
}

export function setSessionCookie(c: Context, token: string): void {
  const url = new URL(c.req.url);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE,
    secure: url.protocol === "https:",
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function originAllowed(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost(c.req.header("host"), c.req.url);
  } catch {
    return false;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCredentials(body: unknown):
  | { email: string; password: string }
  | { error: string } {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const rec = body as Record<string, unknown>;
  const email = String(rec.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(rec.password ?? "");
  if (!EMAIL_RE.test(email)) return { error: "invalid email" };
  if (password.length < 8) {
    return { error: "password must be at least 8 characters" };
  }
  return { email, password };
}
