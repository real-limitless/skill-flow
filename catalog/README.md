# skill-flow catalog

Normalized **Agent Skills** gallery (`SkillGalleryEntry`).

| Path | Tracked? | Role |
| --- | --- | --- |
| `schema.json` | yes | Contract v1.0.0 |
| `blocklist.txt` | yes | Deny ids/names |
| `seed/` | yes | Curated seed skill trees |
| `entries/*.json` | no (gitignored) | Shards — generate via seed/factory |
| `index.json` / `meta.json` | no | Browse index |

```bash
npm run catalog:seed
npx @real-limitless/skill-flow catalog search pdf
npx @real-limitless/skill-flow catalog show seed:hello-skill
```

Schema version: **1.0.0** (`src/catalog/constants.ts`).
