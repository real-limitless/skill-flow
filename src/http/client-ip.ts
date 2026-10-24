import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { trustedProxy } from "./security.js";

function isIp(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  const v4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  if (v4.test(value)) return true;
  if (!value.includes(":") || !/^[0-9a-fA-F:]+$/.test(value)) return false;
  return value.split("::").length <= 2;
}

function forwardedIp(c: Context): string | null {
  const cf = c.req.header("cf-connecting-ip")?.split(",")[0]?.trim() ?? "";
  if (isIp(cf)) return cf;
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (isIp(forwarded)) return forwarded;
  return null;
}

function socketIp(c: Context): string {
  try {
    const addr = getConnInfo(c).remote.address?.trim();
    if (addr) return addr.slice(0, 128);
  } catch {
    /* app.request() and some adapters have no socket */
  }
  return "unknown";
}

/**
 * Peer address from the socket.
 * CF-Connecting-IP and X-Forwarded-For are used only when SKILL_FLOW_TRUSTED_PROXY=true.
 */
export function clientIp(c: Context): string {
  if (trustedProxy()) {
    const forwarded = forwardedIp(c);
    if (forwarded) return forwarded;
  }
  return socketIp(c);
}
