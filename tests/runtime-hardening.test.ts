import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { redactString } from "../src/audit/log.js";
import { ControlStore } from "../src/db/control.js";
import { createApp } from "../src/http/app.js";
import { contentSecurityPolicy, inlineScriptHashes } from "../src/http/security.js";

const temps: string[] = [];
const stores: ControlStore[] = [];
const prev = {
  home: process.env.SKILL_FLOW_HOME,
  env: process.env.SKILL_FLOW_ENV,
  proxy: process.env.SKILL_FLOW_TRUSTED_PROXY,
  cors: process.env.SKILL_FLOW_CORS_ORIGINS,
  max: process.env.SKILL_FLOW_AUTH_MAX_ATTEMPTS,
  window: process.env.SKILL_FLOW_AUTH_WINDOW_SEC,
  lockout: process.env.SKILL_FLOW_AUTH_LOCKOUT_SEC,
};

afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
  restore("SKILL_FLOW_HOME", prev.home);
  restore("SKILL_FLOW_ENV", prev.env);
  restore("SKILL_FLOW_TRUSTED_PROXY", prev.proxy);
  restore("SKILL_FLOW_CORS_ORIGINS", prev.cors);
  restore("SKILL_FLOW_AUTH_MAX_ATTEMPTS", prev.max);
  restore("SKILL_FLOW_AUTH_WINDOW_SEC", prev.window);
  restore("SKILL_FLOW_AUTH_LOCKOUT_SEC", prev.lockout);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function cookieHeader(res: Response): string {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  return cookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function boot(adminToken = "setup-token-value-0123456789") {
  const home = await mkdtemp(join(tmpdir(), "sf-runtime-"));
  temps.push(home);
  process.env.SKILL_FLOW_HOME = home;
  const store = new ControlStore(join(home, "control.sqlite"));
  stores.push(store);
  const app = createApp({
    store,
    catalogDir: join(home, "catalog"),
    adminToken,
  });
  return { app, store, home, adminToken };
}

async function capture(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return lines.join("");
}

describe("audit log redaction", () => {
  it("redacts credential-shaped text and known secret values", () => {
    const secret = "tok-sentinel-should-never-leak";
    const cleaned = redactString(
      `Authorization: Bearer ${secret} password="pw-sentinel-should-never-leak" cookie=${secret}`,
      [secret, "pw-sentinel-should-never-leak"],
    );
    expect(cleaned).not.toContain(secret);
    expect(cleaned).not.toContain("pw-sentinel-should-never-leak");
    expect(cleaned).toContain("[redacted]");
  });

  it("never writes passwords, tokens, cookies, or authorization to stdout", async () => {
    const password = "pw-sentinel-should-never-leak";
    const token = "tok-sentinel-should-never-leak-extra";
    const cookie = "cookie-sentinel-should-never-leak";
    const { app } = await boot(token);
    const body = await capture(async () => {
      const res = await app.request("/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Cookie: `sf_op=${cookie}`,
          "X-Request-Id": "req-fixed1",
          "User-Agent": `ua ${token}`,
        },
        body: JSON.stringify({
          email: "ops@example.com",
          password,
          setupToken: token,
        }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("x-request-id")).toBe("req-fixed1");
    });
    expect(body).not.toContain(password);
    expect(body).not.toContain(token);
    expect(body).not.toContain(cookie);
    expect(body).not.toContain("Authorization");
    const line = body
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => JSON.parse(row) as Record<string, unknown>)
      .find((row) => row.event === "auth_failure");
    expect(line).toBeTruthy();
    for (const field of [
      "ts",
      "level",
      "service",
      "env",
      "project",
      "event",
      "request_id",
      "actor",
      "client_ip",
      "user_agent",
      "host",
      "path",
      "method",
      "status",
      "action",
      "outcome",
    ]) {
      expect(line).toHaveProperty(field);
    }
    expect(line?.service).toBe("skill-flow");
    expect(line?.project).toBe("real-limitless");
    expect(line?.request_id).toBe("req-fixed1");
    expect(line?.outcome).toBe("failure");
    expect(String(line?.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("replaces an unsafe inbound request id", async () => {
    const { app } = await boot();
    const res = await app.request("/health", { headers: { "X-Request-Id": "../etc/passwd" } });
    const id = res.headers.get("x-request-id") ?? "";
    expect(id.startsWith("req_")).toBe(true);
    expect(id).not.toContain("..");
  });
});

describe("sessions and audit storage", () => {
  it("revokes every session for an operator and refuses audit edits", async () => {
    const { app, store } = await boot();
    const setup = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Token": "setup-token-value-0123456789" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(setup.status).toBe(201);
    const first = (await setup.json()) as { csrf: string; operator: { id: string } };
    const cookieA = cookieHeader(setup);
    const again = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    const cookieB = cookieHeader(again);
    expect((await app.request("/v1/auth/me", { headers: { Cookie: cookieB } })).status).toBe(200);

    const revoked = await app.request("/v1/auth/revoke-sessions", {
      method: "POST",
      headers: { Cookie: cookieA, "X-CSRF-Token": first.csrf },
    });
    expect(revoked.status).toBe(200);
    expect((await app.request("/v1/auth/me", { headers: { Cookie: cookieA } })).status).toBe(401);
    expect((await app.request("/v1/auth/me", { headers: { Cookie: cookieB } })).status).toBe(401);

    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    const csrf = ((await login.json()) as { csrf: string }).csrf;
    const cookie = cookieHeader(login);
    const other = await app.request("/v1/operators", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ email: "second@example.com", password: "password12" }),
    });
    const second = ((await other.json()) as { operator: { id: string } }).operator.id;
    const secondLogin = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "second@example.com", password: "password12" }),
    });
    const secondCookie = cookieHeader(secondLogin);
    const kill = await app.request(`/v1/operators/${second}/sessions/revoke`, {
      method: "POST",
      headers: { Authorization: "Bearer setup-token-value-0123456789" },
    });
    expect(kill.status).toBe(200);
    expect((await app.request("/v1/auth/me", { headers: { Cookie: secondCookie } })).status).toBe(401);

    store.writeAudit("install", { name: "ok-skill" });
    expect(() => store.db.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
    expect(() => store.db.prepare("UPDATE audit_events SET action = 'tamper'").run()).toThrow(/append-only/);
    expect(store.listAudit(5).some((event) => event.action === "install")).toBe(true);
  });
});

describe("headers, cors, and client ip", () => {
  it("sets browser headers and keeps CORS off the wildcard", async () => {
    const { app } = await boot();
    const health = await app.request("http://127.0.0.1:8788/health");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("x-frame-options")).toBe("DENY");
    expect(health.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = health.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(health.headers.get("strict-transport-security")).toBeNull();
    expect(health.headers.get("access-control-allow-origin")).toBeNull();

    const https = await app.request("https://127.0.0.1/health");
    expect(https.headers.get("strict-transport-security")).toContain("max-age=31536000");

    const spoofed = await app.request("http://127.0.0.1:8788/health", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    expect(spoofed.headers.get("strict-transport-security")).toBeNull();

    const cross = await app.request("http://127.0.0.1:8788/health", {
      headers: { Origin: "https://evil.example" },
    });
    expect(cross.headers.get("access-control-allow-origin")).toBeNull();

    const same = await app.request("http://127.0.0.1:8788/health", {
      headers: { Origin: "http://127.0.0.1:8788" },
    });
    expect(same.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8788");
  });

  it("allows only configured cross-origin callers", async () => {
    process.env.SKILL_FLOW_CORS_ORIGINS = "https://ops.example";
    const { app } = await boot();
    const ok = await app.request("/health", { headers: { Origin: "https://ops.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://ops.example");
    const no = await app.request("/health", { headers: { Origin: "https://other.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("trusts forwarded client IPs only when configured", async () => {
    process.env.SKILL_FLOW_TRUSTED_PROXY = "true";
    process.env.SKILL_FLOW_AUTH_MAX_ATTEMPTS = "2";
    process.env.SKILL_FLOW_AUTH_WINDOW_SEC = "60";
    process.env.SKILL_FLOW_AUTH_LOCKOUT_SEC = "60";
    const { app } = await boot();
    const fail = (ip: string, email: string) =>
      app.request("/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
          "CF-Connecting-IP": ip,
        },
        body: JSON.stringify({ email, password: "password12" }),
      });
    expect((await fail("203.0.113.10", "a@example.com")).status).toBe(401);
    expect((await fail("203.0.113.11", "b@example.com")).status).toBe(401);
    expect((await fail("203.0.113.10", "c@example.com")).status).toBe(429);
    expect((await fail("203.0.113.12", "d@example.com")).status).toBe(401);

    delete process.env.SKILL_FLOW_TRUSTED_PROXY;
    const { app: plain } = await boot();
    const shared = (ip: string, email: string) =>
      plain.request("/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
        },
        body: JSON.stringify({ email, password: "password12" }),
      });
    expect((await shared("198.51.100.10", "e@example.com")).status).toBe(401);
    expect((await shared("198.51.100.11", "f@example.com")).status).toBe(429);
  });

  it("hashes inline admin scripts into the policy", () => {
    const html = "<script>var t = 1;</script><script src=\"/admin/assets/app.js\"></script>";
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    expect(contentSecurityPolicy(html)).toContain(hashes[0]!);
    expect(contentSecurityPolicy(html)).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
