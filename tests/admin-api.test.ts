import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ControlStore } from "../src/db/control.js";
import { createApp } from "../src/http/app.js";
import { writeMinimalSkill } from "../src/package/resolve-source.js";

const temps: string[] = [];
const stores: ControlStore[] = [];
const prevHome = process.env.SKILL_FLOW_HOME;

afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
  if (prevHome === undefined) delete process.env.SKILL_FLOW_HOME;
  else process.env.SKILL_FLOW_HOME = prevHome;
});

describe("admin API", () => {
  it("installs and uninstalls a skill with the admin token", async () => {
    const home = await mkdtemp(join(tmpdir(), "sf-admin-home-"));
    const skillDir = await mkdtemp(join(tmpdir(), "sf-admin-skill-"));
    const dest = await mkdtemp(join(tmpdir(), "sf-admin-dest-"));
    temps.push(home, skillDir, dest);
    process.env.SKILL_FLOW_HOME = home;
    await writeMinimalSkill(
      skillDir,
      "http-demo-skill",
      "HTTP admin install round-trip skill for skill-flow tests.",
    );
    const store = new ControlStore(join(home, "control.sqlite"));
    stores.push(store);
    const app = createApp({
      store,
      catalogDir: join(home, "catalog"),
      adminToken: "admin-secret-token",
    });

    const auth = { Authorization: "Bearer admin-secret-token" };
    const status = await app.request("/v1/status", { headers: auth });
    expect(status.status).toBe(200);

    const search = await app.request("/v1/catalog/search?q=demo", {
      headers: auth,
    });
    expect(search.status).toBe(200);

    const installed = await app.request("/v1/installs", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: skillDir,
        target: "generic",
        genericPath: dest,
      }),
    });
    expect(installed.status).toBe(201);
    const body = (await installed.json()) as {
      result: { name: string; paths: string[] };
    };
    expect(body.result.name).toBe("http-demo-skill");
    expect(body.result.paths.length).toBe(1);

    const events = await app.request("/v1/audit/events", { headers: auth });
    expect(events.status).toBe(200);
    const audit = (await events.json()) as {
      events: Array<{ action: string }>;
    };
    expect(audit.events.some((e) => e.action === "install")).toBe(true);

    const removed = await app.request(
      `/v1/installs/${encodeURIComponent("http-demo-skill")}?target=generic&genericPath=${encodeURIComponent(dest)}`,
      { method: "DELETE", headers: auth },
    );
    expect(removed.status).toBe(200);
  });
});
