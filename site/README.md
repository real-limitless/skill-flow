# skill-flow marketing site

Static shell + catalog JSON for GitHub Pages.

```bash
npm run catalog:seed
npm run site:build          # → site/out (SITE_BASE=/skill-flow)
SITE_BASE= npm run site:build && npx serve site/out -p 4173
```

Pages workflow deploys `site/out` from `main`.
