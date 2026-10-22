import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adminAssetPath, createApp } from "../src/http/app.js";
import { ControlStore } from "../src/db/control.js";

const adminDir = mkdtempSync(join(tmpdir(), "sf-admin-ui-"));
mkdirSync(join(adminDir, "assets"));
writeFileSync(join(adminDir, "index.html"), '<!DOCTYPE html><div id="root"></div>');
writeFileSync(join(adminDir, "assets", "index-abc123.js"), "console.log(1)");
writeFileSync(join(adminDir, "login.html"), "<!DOCTYPE html>login");
const prev = process.env.SKILL_FLOW_ADMIN_DIR;
process.env.SKILL_FLOW_ADMIN_DIR = adminDir;
afterAll(() => {
  if (prev === undefined) delete process.env.SKILL_FLOW_ADMIN_DIR;
  else process.env.SKILL_FLOW_ADMIN_DIR = prev;
});

function app() {
  const home = mkdtempSync(join(tmpdir(), "sf-admin-ui-home-"));
  return createApp({ store: new ControlStore(join(home, "control.sqlite")) });
}

describe("admin UI static serving", () => {
  it("serves the SPA shell, hashed assets and redirect pages", async () => {
    const a = app();
    const index = await a.request("/admin/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('id="root"');
    const js = await a.request("/admin/assets/index-abc123.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect((await a.request("/admin/login.html")).status).toBe(200);
    const redirect = await a.request("/admin");
    expect(redirect.status).toBe(302);
  });

  it("rejects traversal, unknown types and missing files", async () => {
    const a = app();
    for (const p of [
      "/admin/..%2Fpackage.json",
      "/admin/assets/..%2F..%2Fpackage.json",
      "/admin/%2e%2e/%2e%2e/package.json",
      "/admin/assets/missing.js",
      "/admin/index.ts",
    ]) {
      expect((await a.request(p)).status, p).toBe(404);
    }
    expect(adminAssetPath(adminDir, "../x.js")).toBeNull();
    expect(adminAssetPath(adminDir, "assets//x.js")).toBeNull();
  });

  it("built UI exists after npm run build", () => {
    if (!existsSync(join(process.cwd(), "dist/admin/index.html"))) return;
    expect(existsSync(join(process.cwd(), "dist/admin/login.html"))).toBe(true);
  });
});
