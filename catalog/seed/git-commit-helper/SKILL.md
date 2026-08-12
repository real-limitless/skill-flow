---
name: git-commit-helper
description: "Draft conventional commit messages from staged diffs. Use when the user asks for a commit message, conventional commits, or help committing."
license: Apache-2.0
metadata:
  author: skill-flow
  provenance: seed
---

# Git Commit Helper

## Steps

1. Run `git status` and `git diff --staged` (fallback to unstaged if empty).
2. Summarize intent in one sentence.
3. Propose a conventional commit subject (type(scope): summary) ≤72 chars.
4. Optional body with bullets; no secrets or tokens.
5. Do not commit unless the user explicitly asks.
