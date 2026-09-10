import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../src/http/server.js";

const temps: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()!();
  }
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

describe("HTTP /mcp", () => {
  it("requires auth and lists sf_* tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-mcp-"));
    temps.push(dir);
    const token = "mcp-admin-token";
    const running = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      catalogDir: join(dir, "catalog"),
      dbPath: join(dir, "control.sqlite"),
      adminToken: token,
    });
    cleanups.push(running.close);

    const denied = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(denied.status).toBe(401);

    const health = await fetch(`${running.url}/health`);
    expect(health.ok).toBe(true);

    const client = new Client({ name: "skill-flow-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain("sf_search_skills");
    expect(names).toContain("sf_install_skill");
    expect(names).toContain("sf_status");
    await client.close();
  });
});
