---
name: security-review-lite
description: "Lightweight security review checklist for code changes. Use when reviewing PRs for auth, injection, secrets, or unsafe defaults."
license: Apache-2.0
metadata:
  author: skill-flow
  provenance: seed
---

# Security Review Lite

## Checklist

- Secrets or credentials in diff?
- Injection (SQL/command/path) risks?
- AuthZ missing on new endpoints?
- Unsafe deserialization or SSRF?
- Dependency/supply-chain red flags?

Report findings with severity and file references. Do not claim a full audit.
