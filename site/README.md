# skill-flow marketing site

Static shell + catalog JSON for GitHub Pages.

```bash
npm run catalog:seed
npm run site:build          # → site/out (SITE_BASE=/skill-flow)
SITE_BASE= npm run site:build && npx serve site/out -p 4173 --config site/serve.json
```

`site/serve.json` sets `cleanUrls: false` so local `serve` keeps `skill.html?id=…` (the default clean-URL 301 drops the query string).

Pages workflow deploys `site/out` from `main`.
