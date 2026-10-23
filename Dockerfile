# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY ui ./ui
COPY catalog ./catalog
COPY scripts/catalog ./scripts/catalog
RUN npm run build && npm run catalog:seed && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /app
ENV NODE_ENV=production \
    SKILL_FLOW_HOST=0.0.0.0 \
    SKILL_FLOW_PORT=8788 \
    SKILL_FLOW_CATALOG_DIR=/app/catalog
COPY --from=build /app /app
EXPOSE 8788
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js", "serve", "--http", "--host", "0.0.0.0", "--port", "8788"]
