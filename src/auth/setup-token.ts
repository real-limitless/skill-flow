import { bearerToken } from "./http.js";
import { safeEqualStr } from "../crypto.js";

/** Explicit SKILL_FLOW_ENV wins. Otherwise only NODE_ENV=production is non-development. */
export function isDevelopmentEnv(): boolean {
  const configured = (process.env.SKILL_FLOW_ENV ?? "").trim().toLowerCase();
  if (configured === "development") return true;
  if (configured === "production") return false;
  if (configured) return false;
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production";
}

export function presentedSetupToken(input: {
  body: unknown;
  authorization: string | undefined;
  setupHeader: string | undefined;
}): string | null {
  const rec =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};
  const fromBody = typeof rec.setupToken === "string" ? rec.setupToken.trim() : "";
  const fromHeader = (input.setupHeader ?? "").trim();
  const fromAuth = bearerToken(input.authorization) ?? "";
  const values = [fromBody, fromHeader, fromAuth].filter((value) => value.length > 0);
  if (values.length === 0) return "";
  if (values.some((value) => value !== values[0])) return null;
  return values[0]!;
}

/**
 * When the admin token is configured, setup must present it.
 * When it is unset outside development, setup is refused.
 */
export function setupDecision(
  expected: string,
  presented: string | null,
): { ok: true } | { ok: false; error: string } {
  const token = expected.trim();
  if (!token) {
    if (isDevelopmentEnv()) return { ok: true };
    return {
      ok: false,
      error: "setup is disabled until SKILL_FLOW_ADMIN_TOKEN is set",
    };
  }
  const candidate = presented ?? "";
  const match = safeEqualStr(candidate, token);
  if (presented == null || !match) {
    return { ok: false, error: "invalid setup token" };
  }
  return { ok: true };
}
