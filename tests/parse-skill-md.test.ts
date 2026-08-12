import { describe, expect, it } from "vitest";
import { parseSkillMd, validateSkillName } from "../src/package/parse-skill-md.js";

describe("parseSkillMd", () => {
  it("parses valid frontmatter", () => {
    const raw = `---
name: hello-skill
description: Does hello things when user says hi.
license: MIT
---

# Hello
`;
    const p = parseSkillMd(raw);
    expect(p.frontmatter.name).toBe("hello-skill");
    expect(p.frontmatter.description).toContain("hello");
    expect(p.body).toContain("# Hello");
  });

  it("lenient-parses description with colon", () => {
    const raw = `---
name: colon-skill
description: Use when: the user asks about PDFs
---

body
`;
    const p = parseSkillMd(raw);
    expect(p.frontmatter.name).toBe("colon-skill");
    expect(p.frontmatter.description).toContain("PDFs");
  });

  it("rejects missing name", () => {
    expect(() =>
      parseSkillMd(`---
description: only desc
---
`),
    ).toThrow(/name/);
  });
});

describe("validateSkillName", () => {
  it("accepts kebab-case", () => {
    expect(validateSkillName("git-commit-helper")).toEqual([]);
  });
  it("flags uppercase", () => {
    expect(validateSkillName("Hello").length).toBeGreaterThan(0);
  });
});
