import { randomBytes } from "node:crypto";

export const AUDIT_EVENTS = [
  "auth_success",
  "auth_failure",
  "denial",
  "key_change",
  "config_change",
  "admin_action",
  "rate_limit",
  "error",
] as const;

export type AuditEventName = (typeof AUDIT_EVENTS)[number];
export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditLogEvent {
  ts: string;
  level: "info" | "warn" | "error";
  service: "skill-flow";
  env: "development" | "production";
  project: "real-limitless";
  event: AuditEventName;
  request_id: string;
  actor: string;
  client_ip: string;
  user_agent: string;
  host: string;
  path: string;
  method: string;
  status: number;
  action: string;
  outcome: AuditOutcome;
}

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export function serviceEnv(): "development" | "production" {
  const configured = (process.env.SKILL_FLOW_ENV ?? "").trim().toLowerCase();
  if (configured === "production") return "production";
  if (configured === "development") return "development";
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function saneRequestId(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return REQUEST_ID.test(trimmed) ? trimmed : null;
}

export function newRequestId(): string {
  return `req_${randomBytes(16).toString("hex")}`;
}

/** Drop credential-shaped text. Callers also pass known secret values. */
export function redactString(input: string, secrets: readonly string[] = []): string {
  let out = input
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /((?:password|token|secret|authorization|cookie|setupToken|api[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,
      "$1[redacted]",
    );
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function keyActor(token: string): string {
  if (token.length < 16) return "key";
  return `key:${token.slice(0, 4)}`;
}

function redactEvent(event: AuditLogEvent, secrets: readonly string[]): AuditLogEvent {
  const out = { ...event };
  const fields = [
    "request_id",
    "actor",
    "client_ip",
    "user_agent",
    "host",
    "path",
    "method",
    "action",
  ] as const;
  for (const field of fields) out[field] = redactString(out[field], secrets);
  return out;
}

/** One JSON object per line on stdout. No request body and no header dump. */
export function writeAuditLog(event: AuditLogEvent, secrets: readonly string[] = []): void {
  const line = redactEvent(
    {
      ...event,
      ts: event.ts,
      service: "skill-flow",
      project: "real-limitless",
      env: event.env === "production" ? "production" : "development",
    },
    secrets,
  );
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
