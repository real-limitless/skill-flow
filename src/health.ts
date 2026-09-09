import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectHarnesses } from "./harness/registry.js";
import {
  defaultCatalogDir,
  packageRoot,
  projectRoot,
  skillFlowHome,
} from "./paths.js";

const VERSION = "0.1.0";

export async function doctorReport(): Promise<Record<string, unknown>> {
  const catalogDir = defaultCatalogDir();
  let meta: unknown = null;
  try {
    meta = JSON.parse(await readFile(join(catalogDir, "meta.json"), "utf8"));
  } catch {
    meta = null;
  }
  const harnesses = await detectHarnesses();
  return {
    ok: true,
    version: VERSION,
    packageRoot: packageRoot(),
    skillFlowHome: skillFlowHome(),
    catalogDir,
    catalogMeta: meta,
    projectRoot: projectRoot(),
    harnessesPresent: harnesses.filter((h) => h.present).map((h) => h.id),
    node: process.version,
    port: Number(process.env.SKILL_FLOW_PORT || 8788),
  };
}

export function createHealthServer(): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?", 1)[0];
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      const report = await doctorReport();
      const body = JSON.stringify(report, null, 2);
      res.writeHead(report.ok ? 200 : 503, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}

export async function startHealthServer(opts: { host: string; port: number }): Promise<void> {
  const server = createHealthServer();
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port, opts.host, () => {
      process.stderr.write(
        `skill-flow health on http://${opts.host}:${opts.port}/health\n`,
      );
      resolve();
    });
  });
  await new Promise<void>(() => {
    /* keep the process alive until SIGTERM */
  });
}
