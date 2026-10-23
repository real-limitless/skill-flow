import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Lock {
  packages: Record<string, { version?: string }>;
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  overrides?: Record<string, string>;
};
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as Lock;

function resolved(name: string): string {
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`missing lock entry for ${name}`);
  return version;
}

function gte(version: string, floor: string): boolean {
  const parse = (value: string) => value.split(".").map((part) => Number(part));
  const left = parse(version);
  const right = parse(floor);
  for (let i = 0; i < 3; i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

describe("supply chain floors", () => {
  it("locks the patched releases", () => {
    const floors: Record<string, string> = {
      "@modelcontextprotocol/sdk": "1.32.2",
      undici: "6.29.1",
      hono: "4.13.13",
      vitest: "4.1.12",
      "proxy-addr": "2.0.8",
      "source-map-js": "1.2.2",
      "fast-uri": "3.1.9",
      "ip-address": "10.7.4",
      qs: "6.16.1",
    };
    for (const [name, floor] of Object.entries(floors)) {
      expect(gte(resolved(name), floor), name).toBe(true);
    }
  });

  it("keeps the npm overrides that close transitive findings", () => {
    expect(pkg.overrides?.["proxy-addr"]).toBeTruthy();
    expect(pkg.overrides?.["source-map-js"]).toBeTruthy();
    expect(pkg.overrides?.["fast-uri"]).toBeTruthy();
    expect(pkg.overrides?.hono).toBeTruthy();
    expect(pkg.overrides?.["ip-address"]).toBeTruthy();
    expect(pkg.overrides?.qs).toBeTruthy();
  });
});
