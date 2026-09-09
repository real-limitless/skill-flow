import { createHealthServer, doctorReport } from "../src/health.js";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("doctorReport is ok", async () => {
    const report = await doctorReport();
    expect(report.ok).toBe(true);
    expect(report.version).toBeTruthy();
  });

  it("HTTP /health returns json", async () => {
    const server = createHealthServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
