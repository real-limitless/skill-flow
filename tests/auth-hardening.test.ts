import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeEqualStr } from "../src/crypto.js";
import { ControlStore } from "../src/db/control.js";
import { createApp } from "../src/http/app.js";
import { isHttpsGitUrl, parseInstallRequest } from "../src/http/validate-request.js";
import { writeMinimalSkill } from "../src/package/resolve-source.js";

const temps: string[] = [];
const stores: ControlStore[] = [];
const prevEnv = {
  home: process.env.SKILL_FLOW_HOME,
  sfEnv: process.env.SKILL_FLOW_ENV,
  max: process.env.SKILL_FLOW_AUTH_MAX_ATTEMPTS,
  window: process.env.SKILL_FLOW_AUTH_WINDOW_SEC,
  lockout: process.env.SKILL_FLOW_AUTH_LOCKOUT_SEC,
  roots: process.env.SKILL_FLOW_PATH_ROOTS,
};

afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
  restore("SKILL_FLOW_HOME", prevEnv.home);
  restore("SKILL_FLOW_ENV", prevEnv.sfEnv);
  restore("SKILL_FLOW_AUTH_MAX_ATTEMPTS", prevEnv.max);
  restore("SKILL_FLOW_AUTH_WINDOW_SEC", prevEnv.window);
  restore("SKILL_FLOW_AUTH_LOCKOUT_SEC", prevEnv.lockout);
  restore("SKILL_FLOW_PATH_ROOTS", prevEnv.roots);
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
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function boot(opts: { adminToken?: string; ipHeader?: boolean } = {}) {
  const home = await mkdtemp(join(tmpdir(), "sf-hard-"));
  temps.push(home);
  process.env.SKILL_FLOW_HOME = home;
  const store = new ControlStore(join(home, "control.sqlite"));
  stores.push(store);
  const app = createApp({
    store,
    catalogDir: join(home, "catalog"),
    adminToken: opts.adminToken ?? "",
    clientIp: opts.ipHeader
      ? (c) => c.req.header("x-test-ip") || "unknown"
      : undefined,
  });
  return { app, store, home };
}

describe("setup token", () => {
  it("compares unequal lengths without treating them as equal", () => {
    expect(safeEqualStr("abc", "abc")).toBe(true);
    expect(safeEqualStr("abc", "abcd")).toBe(false);
    expect(safeEqualStr("", "token")).toBe(false);
  });

  it("refuses setup when the token is set and not presented", async () => {
    const { app } = await boot({ adminToken: "setup-token-value" });
    const res = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("invalid setup token");
  });

  it("accepts the setup token from the body or a bearer header", async () => {
    const { app, store } = await boot({ adminToken: "setup-token-value" });
    const header = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer setup-token-value",
      },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(header.status).toBe(201);
    expect(store.countOperators()).toBe(1);
  });

  it("refuses setup outside development when no token is configured", async () => {
    process.env.SKILL_FLOW_ENV = "production";
    const { app } = await boot();
    const res = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("SKILL_FLOW_ADMIN_TOKEN");
  });

  it("allows setup in development when no token is configured", async () => {
    process.env.SKILL_FLOW_ENV = "development";
    const { app } = await boot();
    const res = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("auth rate limit", () => {
  it("locks login per IP and per account with Retry-After", async () => {
    process.env.SKILL_FLOW_AUTH_MAX_ATTEMPTS = "2";
    process.env.SKILL_FLOW_AUTH_WINDOW_SEC = "60";
    process.env.SKILL_FLOW_AUTH_LOCKOUT_SEC = "120";
    const { app } = await boot({ adminToken: "setup-token-value", ipHeader: true });
    const setup = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Ip": "10.0.0.1",
        "X-Setup-Token": "setup-token-value",
      },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(setup.status).toBe(201);

    const fail = (ip: string, email: string) =>
      app.request("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Ip": ip },
        body: JSON.stringify({ email, password: "wrong-password" }),
      });

    expect((await fail("10.0.0.1", "ops@example.com")).status).toBe(401);
    const locked = await fail("10.0.0.1", "ops@example.com");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);

    const otherAccountSameIp = await fail("10.0.0.1", "other@example.com");
    expect(otherAccountSameIp.status).toBe(429);

    const sameAccountOtherIp = await fail("10.0.0.2", "ops@example.com");
    expect(sameAccountOtherIp.status).toBe(429);

    const fresh = await fail("10.0.0.3", "third@example.com");
    expect(fresh.status).toBe(401);
  });
});

describe("path and url validation", () => {
  it("accepts only https git URLs", () => {
    expect(isHttpsGitUrl("https://github.com/acme/skill.git")).toBe(true);
    expect(isHttpsGitUrl("http://github.com/acme/skill.git")).toBe(false);
    expect(isHttpsGitUrl("git@github.com:acme/skill.git")).toBe(false);
    expect(isHttpsGitUrl("https://user:secret@github.com/acme/skill.git")).toBe(false);
  });

  it("rejects traversal, symlink escape, http urls, and unsafe names", async () => {
    const { app, home } = await boot({ adminToken: "setup-token-value" });
    const auth = { Authorization: "Bearer setup-token-value", "Content-Type": "application/json" };
    const outside = await mkdtemp(join(tmpdir(), "sf-outside-"));
    temps.push(outside);
    await writeMinimalSkill(join(home, "incoming"), "ok-skill", "A skill inside the home root.");
    await symlink(outside, join(home, "escape"));

    const outsideRes = await app.request("/v1/audit", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ source: outside }),
    });
    expect(outsideRes.status).toBe(400);

    const traversal = await app.request("/v1/installs", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ source: join(home, "..", "passwd") }),
    });
    expect(traversal.status).toBe(400);

    const link = await app.request("/v1/audit", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ source: join(home, "escape") }),
    });
    expect(link.status).toBe(400);
    const linkStat = await lstat(join(home, "escape"));
    expect(linkStat.isSymbolicLink()).toBe(true);

    const httpUrl = await app.request("/v1/installs", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ source: "http://example.com/skill.git" }),
    });
    expect(httpUrl.status).toBe(400);
    expect(((await httpUrl.json()) as { error: string }).error).toMatch(/https/);

    const badSub = await app.request("/v1/installs", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ source: join(home, "incoming"), subpath: "../secret" }),
    });
    expect(badSub.status).toBe(400);

    const badName = await app.request("/v1/installs/not%20safe", {
      method: "DELETE",
      headers: auth,
    });
    expect(badName.status).toBe(400);

    const nestedName = await app.request("/v1/installs/foo..bar", {
      method: "DELETE",
      headers: auth,
    });
    expect(nestedName.status).toBe(400);

    const outsideDest = await app.request("/v1/installs", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        source: join(home, "incoming"),
        target: "generic",
        genericPath: outside,
      }),
    });
    expect(outsideDest.status).toBe(400);

    const httpsShape = await parseInstallRequest(
      { source: "https://github.com/acme/skill.git", subpath: "skills" },
      join(home, "catalog"),
    );
    expect(httpsShape.ok).toBe(true);
  });

  it("allows an extra configured root", async () => {
    const { home } = await boot({ adminToken: "setup-token-value" });
    const extra = await mkdtemp(join(tmpdir(), "sf-extra-"));
    temps.push(extra);
    await mkdir(join(extra, "pkg"), { recursive: true });
    await writeFile(join(extra, "pkg", "SKILL.md"), "---\nname: x\n---\n");
    process.env.SKILL_FLOW_PATH_ROOTS = extra;
    const parsed = await parseInstallRequest(
      { source: join(extra, "pkg") },
      join(home, "catalog"),
    );
    expect(parsed.ok).toBe(true);
  });
});

describe("origin checks and health", () => {
  it("returns a minimal health payload and keeps detail behind auth", async () => {
    const { app } = await boot({ adminToken: "setup-token-value" });
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const hidden = await app.request("/v1/status");
    expect(hidden.status).toBe(401);
    const detail = await app.request("/v1/status", {
      headers: { Authorization: "Bearer setup-token-value" },
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { version?: string; catalogDir?: string };
    expect(body.version).toBeTruthy();
    expect(body.catalogDir).toBeTruthy();
  });

  it("rejects a mismatched origin on cookie /mcp and logout, not on bearer", async () => {
    const { app } = await boot({ adminToken: "setup-token-value" });
    const setup = await app.request("http://127.0.0.1:8788/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Token": "setup-token-value" },
      body: JSON.stringify({ email: "ops@example.com", password: "password12" }),
    });
    expect(setup.status).toBe(201);
    const cookie = cookieHeader(setup);

    const mcp = await app.request("http://127.0.0.1:8788/mcp", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(mcp.status).toBe(403);

    const bearer = await app.request("http://127.0.0.1:8788/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer setup-token-value",
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(bearer.status).not.toBe(403);

    const logout = await app.request("http://127.0.0.1:8788/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example" },
    });
    expect(logout.status).toBe(403);
    const me = await app.request("http://127.0.0.1:8788/v1/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(me.status).toBe(200);
  });
});
