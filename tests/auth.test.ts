import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ControlStore } from "../src/db/control.js";
import { createApp } from "../src/http/app.js";

const temps: string[] = [];
const stores: ControlStore[] = [];

afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

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

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "sf-auth-"));
  temps.push(dir);
  const store = new ControlStore(join(dir, "control.sqlite"));
  stores.push(store);
  const app = createApp({
    store,
    catalogDir: join(dir, "catalog"),
    adminToken: "break-glass-token",
  });
  return { app, store };
}

describe("operator auth", () => {
  it("rejects /v1 without a session or admin token", async () => {
    const { app } = await boot();
    const res = await app.request("/v1/status");
    expect(res.status).toBe(401);
  });

  it("setup is allowed only when operator count is 0", async () => {
    const { app } = await boot();
    const status = await app.request("/v1/auth/status");
    expect(status.status).toBe(200);
    expect(((await status.json()) as { setupRequired: boolean }).setupRequired).toBe(
      true,
    );

    const setup = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ops@example.com",
        password: "password12",
      }),
    });
    expect(setup.status).toBe(201);
    const cookie = cookieHeader(setup);
    expect(cookie).toMatch(/sf_op=/);

    const me = await app.request("/v1/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(me.status).toBe(200);

    const again = await app.request("/v1/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "other@example.com",
        password: "password12",
      }),
    });
    expect(again.status).toBe(409);

    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ops@example.com",
        password: "password12",
      }),
    });
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as { csrf: string };
    const loginCookie = cookieHeader(login);

    const missingCsrf = await app.request("/v1/operators", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: loginCookie,
      },
      body: JSON.stringify({
        email: "second@example.com",
        password: "password12",
      }),
    });
    expect(missingCsrf.status).toBe(403);

    const add = await app.request("/v1/operators", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: loginCookie,
        "X-CSRF-Token": loginBody.csrf,
      },
      body: JSON.stringify({
        email: "second@example.com",
        password: "password12",
      }),
    });
    expect(add.status).toBe(201);

    const loginPage = await app.request("/admin/login.html");
    expect(loginPage.status).toBe(200);
    expect(await loginPage.text()).toContain("Sign in");
  });

  it("break-glass admin token can list operators", async () => {
    const { app } = await boot();
    const denied = await app.request("/v1/operators");
    expect(denied.status).toBe(401);
    const ok = await app.request("/v1/operators", {
      headers: { Authorization: "Bearer break-glass-token" },
    });
    expect(ok.status).toBe(200);
  });
});
