import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditFlag, AuditReport, SkillPackageInfo, SkillRisk } from "../types.js";

const URL_RE = /https?:\/\/[^\s)'"`<>]+/gi;
const SUSPICIOUS = [
  { id: "curl-pipe", re: /curl\s+[^\n|]*\|\s*(?:ba)?sh/i, severity: "high" as const },
  { id: "wget-pipe", re: /wget\s+[^\n|]*\|\s*(?:ba)?sh/i, severity: "high" as const },
  { id: "eval", re: /\beval\s*\(/i, severity: "medium" as const },
  { id: "base64-decode", re: /base64\s+-d|atob\s*\(/i, severity: "medium" as const },
  {
    id: "exfil-hint",
    re: /exfiltrat|steal\s+(tokens?|secrets?|credentials?)/i,
    severity: "high" as const,
  },
  {
    id: "secret-path",
    re: /\.env\b|id_rsa|aws_secret|API_KEY\s*=/i,
    severity: "medium" as const,
  },
];

function rank(a: SkillRisk, b: SkillRisk): SkillRisk {
  const order: SkillRisk[] = ["unknown", "low", "medium", "high"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))] ?? "unknown";
}

export async function auditPackage(pkg: SkillPackageInfo): Promise<AuditReport> {
  const flags: AuditFlag[] = [];
  const urls = new Set<string>();
  let risk: SkillRisk = "low";

  const hasScripts = pkg.files.some(
    (f) =>
      f.startsWith("scripts/") ||
      /\.(py|sh|bash|js|ts|mjs|cjs)$/i.test(f),
  );
  if (hasScripts) {
    flags.push({
      id: "has-scripts",
      severity: "medium",
      message: "Package includes executable scripts or code files",
    });
    risk = rank(risk, "medium");
  }

  const textFiles = pkg.files.filter(
    (f) =>
      /\.(md|txt|py|sh|bash|js|ts|mjs|cjs|json|yml|yaml)$/i.test(f) ||
      f === "SKILL.md",
  );

  for (const rel of textFiles) {
    let content: string;
    try {
      content = await readFile(join(pkg.root, rel), "utf8");
    } catch {
      continue;
    }
    for (const m of content.matchAll(URL_RE)) {
      urls.add(m[0].replace(/[.,;]+$/, ""));
    }
    for (const rule of SUSPICIOUS) {
      if (rule.re.test(content)) {
        flags.push({
          id: rule.id,
          severity: rule.severity,
          message: `${rule.id} pattern in ${rel}`,
        });
        risk = rank(risk, rule.severity);
      }
    }
  }

  if (urls.size > 0) {
    flags.push({
      id: "external-urls",
      severity: "low",
      message: `Found ${urls.size} external URL(s) in skill files`,
    });
  }

  for (const w of pkg.parsed.warnings) {
    if (w.includes("does not match")) {
      flags.push({
        id: "name-mismatch",
        severity: "low",
        message: w,
      });
    }
  }

  return {
    risk,
    flags,
    hasScripts,
    fileCount: pkg.files.length,
    externalUrls: [...urls].slice(0, 50),
  };
}

export function auditReportToSecurity(report: AuditReport): {
  risk: SkillRisk;
  flags: string[];
  auditedAt: string;
} {
  return {
    risk: report.risk,
    flags: report.flags.map((f) => f.id),
    auditedAt: new Date().toISOString(),
  };
}
