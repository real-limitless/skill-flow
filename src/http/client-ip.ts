import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/** Socket peer address. Forwarded headers are not trusted here. */
export function clientIp(c: Context): string {
  try {
    const addr = getConnInfo(c).remote.address?.trim();
    if (addr) return addr.slice(0, 128);
  } catch {
    /* app.request() and some adapters have no socket */
  }
  return "unknown";
}
