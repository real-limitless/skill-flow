import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkill, uninstallSkill } from "../src/harness/install.js";
import { writeMinimalSkill, resolveCloneSkillRoot } from "../src/package/resolve-source.js";
import { auditPackage } from "../src/audit/scan.js";
import { loadLocalSkill } from "../src/package/load-local.js";

const temps: string[] = [];

afterEach(async () => {
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

describe("installSkill", () => {
  it("requires confirm", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-skill-"));
    temps.push(dir);
    await writeMinimalSkill(dir, "t-skill", "Test skill for unit tests only.");
    await expect(
      installSkill({ source: dir, confirm: false }),
    ).rejects.toThrow(/confirm/);
  });

  it("installs into generic path and uninstalls", async () => {
    const skillDir = await mkdtemp(join(tmpdir(), "sf-skill-"));
    const installParent = await mkdtemp(join(tmpdir(), "sf-inst-"));
    temps.push(skillDir, installParent);
    await writeMinimalSkill(
      skillDir,
      "unit-demo-skill",
      "Unit demo skill. Use only in skill-flow tests.",
    );

    const result = await installSkill({
      source: skillDir,
      target: "generic",
      genericPath: installParent,
      confirm: true,
    });
    expect(result.name).toBe("unit-demo-skill");
    expect(result.paths.length).toBe(1);
    const md = await readFile(join(result.paths[0], "SKILL.md"), "utf8");
    expect(md).toContain("unit-demo-skill");

    const un = await uninstallSkill({
      name: "unit-demo-skill",
      target: "generic",
      genericPath: installParent,
    });
    expect(un.removed.length).toBe(1);
  });
});

describe("auditPackage", () => {
  it("flags scripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-aud-"));
    temps.push(dir);
    await writeMinimalSkill(dir, "aud-skill", "Audit test skill with a script file.");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
    const pkg = await loadLocalSkill(dir);
    const audit = await auditPackage(pkg);
    expect(audit.hasScripts).toBe(true);
    expect(audit.flags.some((f) => f.id === "has-scripts")).toBe(true);
  });
});

describe("resolveCloneSkillRoot", () => {
  it("errors when a clone has more than one SKILL.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-clone-"));
    temps.push(root);
    const a = join(root, "one");
    const b = join(root, "two");
    await mkdir(a);
    await mkdir(b);
    await writeMinimalSkill(a, "one-skill", "First skill in a multi-skill clone.");
    await writeMinimalSkill(b, "two-skill", "Second skill in a multi-skill clone.");
    await expect(resolveCloneSkillRoot(root, { url: "https://example.com/repo" })).rejects.toThrow(
      /--subpath/,
    );
    const picked = await resolveCloneSkillRoot(root, { subpath: "two" });
    expect(picked).toBe(join(root, "two"));
  });
});
