import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  bearerToken,
  clearSessionCookie,
  originAllowed,
  parseCredentials,
  readSessionToken,
  setSessionCookie,
} from "../auth/http.js";
import { AuthRateLimiter, readAuthRateConfig } from "../auth/rate-limit.js";
import { presentedSetupToken, setupDecision } from "../auth/setup-token.js";
import {
  keyActor,
  newRequestId,
  saneRequestId,
  serviceEnv,
  writeAuditLog,
  type AuditEventName,
  type AuditOutcome,
} from "../audit/log.js";
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
import { doctorReport, publicHealth } from "../health.js";
import { createSkillFlowServer } from "../mcp/server.js";
import { resolveSkillSource } from "../package/resolve-source.js";
import { defaultCatalogDir } from "../paths.js";
import type { Context } from "hono";
import { clientIp } from "./client-ip.js";
import {
  allowedCorsOrigin,
  requestHost,
  contentSecurityPolicy,
  requestIsHttps,
} from "./security.js";
import {
  parseAuditRequest,
  parseDeleteInstall,
  parseInstallRequest,
} from "./validate-request.js";

export interface HttpAppOpts {
  catalogDir?: string;
  adminToken?: string;
  store: ControlStore;
  /** Override the peer address. Production uses the socket, not forwarded headers. */
  clientIp?: (c: Context) => string;
}

type Vars = {
  auth: "admin" | "user";
  csrf?: string;
  operatorId?: string;
  requestId?: string;
  actor?: string;
};

type AppContext = Context<{ Variables: Vars }>;
const OPERATOR_ID = /^op_[a-f0-9]{24}$/;

function resolveAdminDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.SKILL_FLOW_ADMIN_DIR,
    join(here, "../admin"),
    join(here, "../../dist/admin"),
    join(process.cwd(), "dist/admin"),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return resolve(dir);
  }
  return null;
}

const ADMIN_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

/**
 * login.html and setup.html live in ui/public and are copied into dist/admin
 * by Vite. Tests and `tsx` run before that build, so serve the source redirects
 * when no admin bundle is on disk.
 */
function sourceAuthRedirect(rel: string): string | null {
  if (rel !== "login.html" && rel !== "setup.html") return null;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(process.cwd(), "ui/public", rel), join(here, "../../ui/public", rel)];
  return candidates.find((file) => existsSync(file)) ?? null;
}

/** Resolve a request path under the admin dir; null on traversal or unknown type. */
export function adminAssetPath(adminDir: string, rel: string): string | null {
  if (!/^[a-zA-Z0-9._/-]+$/.test(rel) || rel.split("/").some((seg) => seg === ".." || seg === "")) return null;
  if (!ADMIN_TYPES[extname(rel)]) return null;
  const full = resolve(adminDir, rel);
  if (!full.startsWith(adminDir + sep)) return null;
  return full;
}

export function createApp(opts: HttpAppOpts) {
  const catalogDir = opts.catalogDir ?? defaultCatalogDir();
  const store = opts.store;
  const adminToken = (opts.adminToken ?? "").trim();
  const app = new Hono<{ Variables: Vars }>();
  const adminDir = resolveAdminDir();
  const rate = readAuthRateConfig();
  const limiter = new AuthRateLimiter(rate.maxAttempts, rate.windowMs, rate.lockoutMs);
  const ipOf = opts.clientIp ?? clientIp;
  const csp = contentSecurityPolicy(
    adminDir && existsSync(join(adminDir, "index.html"))
      ? readFileSync(join(adminDir, "index.html"), "utf8")
      : null,
  );
  const secrets = adminToken.length >= 8 ? [adminToken] : [];

  app.use("*", async (c, next) => {
    const id = saneRequestId(c.req.header("x-request-id")) ?? newRequestId();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    await next();
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", csp);
    if (requestIsHttps(c)) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  app.use(
    "*",
    cors({
      origin: (origin, c) =>
        allowedCorsOrigin(origin, requestHost(c.req.header("host"), c.req.url)),
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  const audit = (
    c: AppContext,
    fields: {
      event: AuditEventName;
      level: "info" | "warn" | "error";
      status: number;
      action: string;
      outcome: AuditOutcome;
      actor?: string;
    },
  ) => {
    writeAuditLog(
      {
        ts: new Date().toISOString(),
        level: fields.level,
        service: "skill-flow",
        env: serviceEnv(),
        project: "real-limitless",
        event: fields.event,
        request_id: c.get("requestId") || "-",
        actor: fields.actor || c.get("actor") || "anonymous",
        client_ip: ipOf(c),
        user_agent: (c.req.header("user-agent") ?? "").slice(0, 256),
        host: requestHost(c.req.header("host"), c.req.url).slice(0, 256),
        path: c.req.path,
        method: c.req.method,
        status: fields.status,
        action: fields.action,
        outcome: fields.outcome,
      },
      secrets,
    );
  };

  app.get("/health", (c) => c.json(publicHealth()));
  app.get("/", async (c) => c.redirect("/admin/"));

  app.get("/admin", (c) => c.redirect("/admin/"));
  app.get("/admin/", (c) => {
    if (!adminDir) return c.json({ error: "admin UI not found" }, 404);
    return c.html(readFileSync(join(adminDir, "index.html"), "utf8"));
  });
  app.get("/admin/*", (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice("/admin/".length));
    } catch {
      return c.text("not found", 404);
    }
    if (!adminDir) {
      const redirect = sourceAuthRedirect(rel);
      if (!redirect) return c.text("not found", 404);
      return c.body(readFileSync(redirect), 200, { "Content-Type": ADMIN_TYPES[".html"]! });
    }
    const full = adminAssetPath(adminDir, rel);
    if (!full || !existsSync(full)) return c.text("not found", 404);
    const headers: Record<string, string> = { "Content-Type": ADMIN_TYPES[extname(full)]! };
    if (rel.startsWith("assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    return c.body(readFileSync(full), 200, headers);
  });

  const issue = (c: Parameters<typeof setSessionCookie>[0], email: string, password: string) => {
    const operator = store.createOperator(email, password);
    const sess = store.createSession(operator);
    setSessionCookie(c, sess.token);
    return { operator, csrf: sess.csrf };
  };

  const accountKey = (body: unknown): string => {
    if (!body || typeof body !== "object") return "_";
    const email = String((body as Record<string, unknown>).email ?? "")
      .trim()
      .toLowerCase();
    if (!email || email.length > 320) return "_";
    return email;
  };

  const tooMany = (c: AppContext, seconds: number, action: string) => {
    audit(c, {
      event: "rate_limit",
      level: "warn",
      status: 429,
      action,
      outcome: "denied",
    });
    c.header("Retry-After", String(seconds));
    return c.json({ error: "too many attempts" }, 429);
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
    const body = await c.req.json().catch(() => ({}));
    const ip = ipOf(c);
    const account = accountKey(body);
    const blocked = limiter.retryAfterSec(ip, account);
    if (blocked) return tooMany(c, blocked, "operator.setup");
    if (!originAllowed(c)) {
      audit(c, { event: "denial", level: "warn", status: 403, action: "operator.setup", outcome: "denied" });
      return c.json({ error: "forbidden origin" }, 403);
    }
    const gate = setupDecision(
      adminToken,
      presentedSetupToken({
        body,
        authorization: c.req.header("authorization"),
        setupHeader: c.req.header("x-setup-token"),
      }),
    );
    if (!gate.ok) {
      const retry = limiter.fail(ip, account);
      if (retry) return tooMany(c, retry, "operator.setup");
      audit(c, { event: "denial", level: "warn", status: 403, action: "operator.setup", outcome: "denied" });
      return c.json({ error: gate.error }, 403);
    }
    if (store.countOperators() > 0) {
      audit(c, { event: "denial", level: "warn", status: 409, action: "operator.setup", outcome: "denied" });
      return c.json({ error: "setup already completed" }, 409);
    }
    const creds = parseCredentials(body);
    if ("error" in creds) {
      const retry = limiter.fail(ip, account);
      if (retry) return tooMany(c, retry, "operator.setup");
      audit(c, { event: "auth_failure", level: "warn", status: 400, action: "operator.setup", outcome: "failure" });
      return c.json({ error: creds.error }, 400);
    }
    const out = issue(c, creds.email, creds.password);
    limiter.success(account);
    store.writeAudit("operator.setup", { email: out.operator.email });
    audit(c, {
      event: "auth_success",
      level: "info",
      status: 201,
      action: "operator.setup",
      outcome: "success",
      actor: out.operator.id,
    });
    return c.json(out, 201);
  });

  app.post("/v1/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ip = ipOf(c);
    const account = accountKey(body);
    const blocked = limiter.retryAfterSec(ip, account);
    if (blocked) return tooMany(c, blocked, "operator.login");
    if (!originAllowed(c)) {
      audit(c, { event: "denial", level: "warn", status: 403, action: "operator.login", outcome: "denied" });
      return c.json({ error: "forbidden origin" }, 403);
    }
    const creds = parseCredentials(body);
    if ("error" in creds) {
      const retry = limiter.fail(ip, account);
      if (retry) return tooMany(c, retry, "operator.login");
      audit(c, { event: "auth_failure", level: "warn", status: 400, action: "operator.login", outcome: "failure" });
      return c.json({ error: creds.error }, 400);
    }
    const operator = store.authenticateOperator(creds.email, creds.password);
    if (!operator) {
      const retry = limiter.fail(ip, creds.email);
      if (retry) return tooMany(c, retry, "operator.login");
      audit(c, { event: "auth_failure", level: "warn", status: 401, action: "operator.login", outcome: "failure" });
      return c.json({ error: "invalid credentials" }, 401);
    }
    limiter.success(creds.email);
    const sess = store.createSession(operator);
    setSessionCookie(c, sess.token);
    store.writeAudit("operator.login", { email: operator.email });
    audit(c, {
      event: "auth_success",
      level: "info",
      status: 200,
      action: "operator.login",
      outcome: "success",
      actor: operator.id,
    });
    return c.json({ operator, csrf: sess.csrf });
  });

  app.post("/v1/auth/logout", (c) => {
    if (!originAllowed(c)) {
      audit(c, { event: "denial", level: "warn", status: 403, action: "operator.logout", outcome: "denied" });
      return c.json({ error: "forbidden origin" }, 403);
    }
    const tok = readSessionToken(c);
    if (tok) store.revokeSession(tok);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post("/v1/auth/revoke-sessions", (c) => {
    if (!originAllowed(c)) {
      audit(c, { event: "denial", level: "warn", status: 403, action: "session.revoke", outcome: "denied" });
      return c.json({ error: "forbidden origin" }, 403);
    }
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    if (!sess) {
      audit(c, { event: "denial", level: "warn", status: 401, action: "session.revoke", outcome: "denied" });
      return c.json({ error: "unauthorized" }, 401);
    }
    const csrf = c.req.header("x-csrf-token") ?? "";
    if (!safeEqualStr(csrf, sess.csrf)) {
      audit(c, { event: "denial", level: "warn", status: 403, action: "session.revoke", outcome: "denied", actor: sess.operator.id });
      return c.json({ error: "invalid csrf" }, 403);
    }
    const revoked = store.revokeOperatorSessions(sess.operator.id);
    clearSessionCookie(c);
    audit(c, {
      event: "admin_action",
      level: "info",
      status: 200,
      action: "session.revoke",
      outcome: "success",
      actor: sess.operator.id,
    });
    return c.json({ ok: true, revoked });
  });

  app.get("/v1/auth/me", (c) => {
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    if (!sess) return c.json({ error: "unauthorized" }, 401);
    return c.json({ operator: sess.operator, csrf: sess.csrf });
  });

  const v1 = new Hono<{ Variables: Vars }>();
  v1.use("*", async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    if (token && adminToken && safeEqualStr(token, adminToken)) {
      c.set("auth", "admin");
      c.set("actor", keyActor(token));
      await next();
      audit(c, {
        event: "key_change",
        level: "info",
        status: c.res.status,
        action: "admin_token.use",
        outcome: c.res.status < 400 ? "success" : "failure",
        actor: keyActor(token),
      });
      return;
    }
    if (token) {
      audit(c, { event: "denial", level: "warn", status: 401, action: "admin_token.use", outcome: "denied" });
      return c.json({ error: "unauthorized" }, 401);
    }
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    if (!sess) {
      audit(c, { event: "denial", level: "warn", status: 401, action: "session", outcome: "denied" });
      return c.json({ error: "unauthorized" }, 401);
    }
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (!originAllowed(c)) {
        audit(c, { event: "denial", level: "warn", status: 403, action: "origin", outcome: "denied", actor: sess.operator.id });
        return c.json({ error: "forbidden origin" }, 403);
      }
      const csrf = c.req.header("x-csrf-token") ?? "";
      if (!safeEqualStr(csrf, sess.csrf)) {
        audit(c, { event: "denial", level: "warn", status: 403, action: "csrf", outcome: "denied", actor: sess.operator.id });
        return c.json({ error: "invalid csrf" }, 403);
      }
    }
    c.set("auth", "user");
    c.set("csrf", sess.csrf);
    c.set("operatorId", sess.operator.id);
    c.set("actor", sess.operator.id);
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
    const parsed = await parseInstallRequest(await c.req.json().catch(() => ({})), catalogDir);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await installSkill(
        {
          source: parsed.value.source,
          target: parsed.value.target || "portable",
          scope: parsed.value.scope || "user",
          genericPath: parsed.value.genericPath,
          subpath: parsed.value.subpath,
          confirm: true,
        },
        { catalogLookup: (id) => readEntry(catalogDir, id) },
      );
      store.writeAudit("install", { name: result.name, source: parsed.value.source });
      audit(c, { event: "admin_action", level: "info", status: 201, action: "install", outcome: "success" });
      return c.json({ result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      audit(c, { event: "admin_action", level: "warn", status: 400, action: "install", outcome: "failure" });
      return c.json({ error: msg }, 400);
    }
  });

  v1.delete("/installs/:name", async (c) => {
    const parsed = await parseDeleteInstall(
      {
        name: c.req.param("name"),
        target: c.req.query("target"),
        genericPath: c.req.query("genericPath"),
      },
      catalogDir,
    );
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await uninstallSkill({
        name: parsed.value.name,
        target: parsed.value.target,
        genericPath: parsed.value.genericPath,
      });
      store.writeAudit("uninstall", { name: parsed.value.name });
      audit(c, { event: "admin_action", level: "info", status: 200, action: "uninstall", outcome: "success" });
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      audit(c, { event: "admin_action", level: "warn", status: 400, action: "uninstall", outcome: "failure" });
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
    const parsed = await parseAuditRequest(await c.req.json().catch(() => ({})), catalogDir);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const { pkg } = await resolveSkillSource(parsed.value.source, {
        catalogLookup: (id) => readEntry(catalogDir, id),
        subpath: parsed.value.subpath,
      });
      const report = await auditPackage(pkg);
      store.writeAudit("audit", { source: parsed.value.source, risk: report.risk });
      audit(c, { event: "admin_action", level: "info", status: 200, action: "audit", outcome: "success" });
      return c.json({ report });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      audit(c, { event: "admin_action", level: "warn", status: 400, action: "audit", outcome: "failure" });
      return c.json({ error: msg }, 400);
    }
  });

  v1.get("/audit/events", (c) =>
    c.json({ events: store.listAudit(Number(c.req.query("limit") || 50)) }),
  );

  v1.get("/operators", (c) => c.json({ operators: store.listOperators() }));

  v1.post("/operators/:id/sessions/revoke", (c) => {
    const id = c.req.param("id");
    if (!OPERATOR_ID.test(id)) {
      audit(c, { event: "denial", level: "warn", status: 400, action: "operator.sessions.revoke", outcome: "denied" });
      return c.json({ error: "invalid operator" }, 400);
    }
    const revoked = store.revokeOperatorSessions(id);
    audit(c, {
      event: "admin_action",
      level: "info",
      status: 200,
      action: "operator.sessions.revoke",
      outcome: "success",
    });
    return c.json({ revoked });
  });

  v1.post("/operators", async (c) => {
    const creds = parseCredentials(await c.req.json().catch(() => ({})));
    if ("error" in creds) return c.json({ error: creds.error }, 400);
    try {
      const operator = store.createOperator(creds.email, creds.password);
      store.writeAudit("operator.create", { email: operator.email });
      audit(c, { event: "admin_action", level: "info", status: 201, action: "operator.create", outcome: "success" });
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

  app.onError((_err, c) => {
    audit(c, { event: "error", level: "error", status: 500, action: "unhandled", outcome: "failure" });
    return c.json({ error: "internal error" }, 500);
  });

  app.all("/mcp", async (c) => {
    const token = bearerToken(c.req.header("authorization"));
    const sess = store.authenticateSession(readSessionToken(c) ?? "");
    const adminOk = Boolean(token && adminToken && safeEqualStr(token, adminToken));
    if (!adminOk && !sess) {
      audit(c, { event: "denial", level: "warn", status: 401, action: "mcp", outcome: "denied" });
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!adminOk && !originAllowed(c)) {
      audit(c, {
        event: "denial",
        level: "warn",
        status: 403,
        action: "mcp",
        outcome: "denied",
        actor: sess?.operator.id,
      });
      return c.json({ error: "forbidden origin" }, 403);
    }
    if (adminOk && token) c.set("actor", keyActor(token));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createSkillFlowServer({ catalogDir });
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    if (adminOk && token) {
      audit(c, {
        event: "key_change",
        level: "info",
        status: response.status,
        action: "admin_token.use",
        outcome: response.status < 400 ? "success" : "failure",
        actor: keyActor(token),
      });
    }
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
