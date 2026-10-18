import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  clearSessionCookie,
  originAllowed,
  parseCredentials,
  readSessionToken,
  setSessionCookie,
} from "../auth/http.js";
import { auditPackage } from "../audit/scan.js";
import { loadIndex, readEntry, searchIndex } from "../catalog/shard.js";
import { safeEqualStr } from "../crypto.js";
import type { ControlStore } from "../db/control.js";
import {
  installSkill,
  listInstalled,
  uninstallSkill,
} from "../harness/install.js";
import { detectHarnesses, HARNESS_REGISTRY } from "../harness/registry.js";
import { doctorReport } from "../health.js";
import { createSkillFlowServer } from "../mcp/server.js";
import { resolveSkillSource } from "../package/resolve-source.js";
import { defaultCatalogDir } from "../paths.js";
import type { InstallScope, InstallTarget } from "../types.js";

export interface HttpAppOpts {
  catalogDir?: string;
  adminToken?: string;
  store: ControlStore;
}

type Vars = {
  auth: "admin" | "user";
  csrf?: string;
  operatorId?: string;
};

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

function resolveAdminDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../admin"),
    join(here, "../../src/admin"),
    join(process.cwd(), "src/admin"),
    join(process.cwd(), "dist/admin"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}

export function createApp(opts: HttpAppOpts) {
  const catalogDir = opts.catalogDir ?? defaultCatalogDir();
  const store = opts.store;
  const adminToken = (opts.adminToken ?? "").trim();
  const app = new Hono<{ Variables: Vars }>();
  const adminDir = resolveAdminDir();

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

  app.get("/health", async (c) => c.json(await doctorReport()));
  app.get("/", async (c) => c.redirect("/admin/"));

  app.get("/admin", (c) => c.redirect("/admin/"));
  app.get("/admin/", (c) => {
    if (!adminDir) return c.json({ error: "admin UI not found" }, 404);
    return c.html(readFileSync(join(adminDir, "index.html"), "utf8"));
  });
  app.get("/admin/:file", (c) => {
    if (!adminDir) return c.text("not found", 404);
    const file = c.req.param("file");
    if (!/^[a-zA-Z0-9._-]+\.(html|js|css)$/.test(file)) {
      return c.text("not found", 404);
    }
    try {
      const body = readFileSync(join(adminDir, file), "utf8");
      const type = file.endsWith(".js")
        ? "application/javascript; charset=utf-8"
        : file.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/html; charset=utf-8";
      return c.body(body, 200, { "Content-Type": type });
    } catch {
      return c.text("not found", 404);
    }
  });

  const issue = (c: Parameters<typeof setSessionCookie>[0], email: string, password: string) => {
    const operator = store.createOperator(email, password);
    const sess = store.createSession(operator);
    setSessionCookie(c, sess.token);
    return { operator, csrf: sess.csrf };
  };

  app.get("/v1/auth/status", (c) =>
    c.json({
      setupRequired: store.countOperators() === 0,
      authenticated: Boolean(
        readSessionToken(c) &&
          store.authenticateSession(readSessionToken(c) ?? ""),
      ),
    }),
  );

  app.post("/v1/auth/setup", async (c) => {
    if (!originAllowed(c)) return c.json({ error: "forbidden origin" }, 403);
    if (store.countOperators() > 0) {
      return c.json({ error: "setup already completed" }, 409);
    }
    const creds = parseCredentials(await c.req.json().catch(() => ({})));
    if ("error" in creds) return c.json({ error: creds.error }, 400);
    const out = issue(c, creds.email, creds.password);
    store.writeAudit("operator.setup", { email: out.operator.email });
    return c.json(out, 201);
  });

  app.post("/v1/auth/login", async (c) => {
    if (!originAllowed(c)) return c.json({ error: "forbidden origin" }, 403);
    const creds = parseCredentials(await c.req.json().catch(() => ({})));
    if ("error" in creds) return c.json({ error: creds.error }, 400);
    const operator = store.authenticateOperator(creds.email, creds.password);
    if (!operator) return c.json({ error: "invalid credentials" }, 401);
    const sess = store.createSession(operator);
    setSessionCookie(c, sess.token);
    store.writeAudit("operator.login", { email: operator.email });
    return c.json({ operator, csrf: sess.csrf });
  });

  app.post("/v1/auth/logout", (c) => {
    const tok = readSessionToken(c);
    if (tok) store.revokeSession(tok);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/v1/auth/me", (c) => {
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    if (!sess) return c.json({ error: "unauthorized" }, 401);
    return c.json({ operator: sess.operator, csrf: sess.csrf });
  });

  const v1 = new Hono<{ Variables: Vars }>();
  v1.use("*", async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    if (token && adminToken && safeEqualStr(token, adminToken)) {
      c.set("auth", "admin");
      await next();
      return;
    }
    if (token) return c.json({ error: "unauthorized" }, 401);
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    if (!sess) return c.json({ error: "unauthorized" }, 401);
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (!originAllowed(c)) return c.json({ error: "forbidden origin" }, 403);
      const csrf = c.req.header("x-csrf-token") ?? "";
      if (!safeEqualStr(csrf, sess.csrf)) {
        return c.json({ error: "invalid csrf" }, 403);
      }
    }
    c.set("auth", "user");
    c.set("csrf", sess.csrf);
    c.set("operatorId", sess.operator.id);
    await next();
  });

  v1.get("/status", async (c) => c.json(await doctorReport()));

  v1.get("/catalog/search", async (c) => {
    const q = c.req.query("q") || "";
    const limit = Number(c.req.query("limit") || 20);
    const index = await loadIndex(catalogDir);
    return c.json({ results: searchIndex(index, q, limit) });
  });

  v1.get("/catalog/entries/:id", async (c) => {
    const entry = await readEntry(catalogDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json({ entry });
  });

  v1.get("/installs", async (c) => {
    const installed = await listInstalled();
    return c.json({ installed });
  });

  v1.post("/installs", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      source?: string;
      target?: string;
      scope?: InstallScope;
      genericPath?: string;
    };
    if (!body.source) return c.json({ error: "source required" }, 400);
    try {
      const result = await installSkill(
        {
          source: body.source,
          target: (body.target as InstallTarget) || "portable",
          scope: body.scope || "user",
          genericPath: body.genericPath,
          confirm: true,
        },
        { catalogLookup: (id) => readEntry(catalogDir, id) },
      );
      store.writeAudit("install", { name: result.name, source: body.source });
      return c.json({ result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  v1.delete("/installs/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const result = await uninstallSkill({
        name,
        target: c.req.query("target") || undefined,
        genericPath: c.req.query("genericPath") || undefined,
      });
      store.writeAudit("uninstall", { name });
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  v1.get("/harnesses", async (c) => {
    const detected = await detectHarnesses();
    return c.json({
      registry: HARNESS_REGISTRY.map((h) => ({
        id: h.id,
        displayName: h.displayName,
        paths: h.paths,
      })),
      detected,
    });
  });

  v1.post("/audit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { source?: string };
    if (!body.source) return c.json({ error: "source required" }, 400);
    try {
      const { pkg } = await resolveSkillSource(body.source, {
        catalogLookup: (id) => readEntry(catalogDir, id),
      });
      const report = await auditPackage(pkg);
      store.writeAudit("audit", { source: body.source, risk: report.risk });
      return c.json({ report });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  v1.get("/audit/events", (c) =>
    c.json({ events: store.listAudit(Number(c.req.query("limit") || 50)) }),
  );

  v1.get("/operators", (c) => c.json({ operators: store.listOperators() }));

  v1.post("/operators", async (c) => {
    const creds = parseCredentials(await c.req.json().catch(() => ({})));
    if ("error" in creds) return c.json({ error: creds.error }, 400);
    try {
      const operator = store.createOperator(creds.email, creds.password);
      store.writeAudit("operator.create", { email: operator.email });
      return c.json({ operator }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE|unique/i.test(msg)) {
        return c.json({ error: "email already exists" }, 409);
      }
      throw err;
    }
  });

  app.route("/v1", v1);

  app.all("/mcp", async (c) => {
    const token = bearer(c.req.header("authorization"));
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    const adminOk = Boolean(token && adminToken && safeEqualStr(token, adminToken));
    if (!adminOk && !sess) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createSkillFlowServer({ catalogDir });
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    const cleanup = () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    };
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            cleanup();
            return;
          }
          controller.enqueue(value);
        } catch (err) {
          cleanup();
          controller.error(err);
        }
      },
      cancel() {
        void reader.cancel().catch(() => undefined);
        cleanup();
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });

  return app;
}
