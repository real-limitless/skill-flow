import { createAdaptorServer } from "@hono/node-server";
import { ControlStore } from "../db/control.js";
import { controlDbPath } from "../paths.js";
import { createApp } from "./app.js";

export interface HttpListenOpts {
  host?: string;
  port?: number;
  catalogDir?: string;
  adminToken?: string;
  dbPath?: string;
}

export async function startHttpServer(opts: HttpListenOpts = {}): Promise<{
  url: string;
  close: () => Promise<void>;
  store: ControlStore;
}> {
  const host = opts.host ?? process.env.SKILL_FLOW_HOST ?? "0.0.0.0";
  const port = Number(opts.port ?? process.env.SKILL_FLOW_PORT ?? 8788);
  const dbPath = opts.dbPath ?? controlDbPath();
  const store = new ControlStore(dbPath);
  const app = createApp({
    catalogDir: opts.catalogDir,
    adminToken: opts.adminToken ?? process.env.SKILL_FLOW_ADMIN_TOKEN ?? "",
    store,
  });
  const nodeServer = createAdaptorServer({
    fetch: app.fetch,
    hostname: host,
    port,
  });
  await new Promise<void>((resolve, reject) => {
    nodeServer.listen(port, host, () => resolve());
    nodeServer.once("error", reject);
  });
  const addr = nodeServer.address();
  const bound = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${bound}`;
  process.stderr.write(`skill-flow listening on ${url}\n`);
  process.stderr.write(`  MCP:   ${url}/mcp\n`);
  process.stderr.write(`  Admin: ${url}/admin/\n`);
  process.stderr.write(`  Health:${url}/health\n`);
  return {
    url,
    store,
    close: async () => {
      store.close();
      await new Promise<void>((resolve, reject) => {
        nodeServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
