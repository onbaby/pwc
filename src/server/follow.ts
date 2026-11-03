import { networkInterfaces } from "node:os";

/**
 * Follow-along: judges scan a QR code, open the console on their own phones, and see the page the presenter is showing.
 * The presenter's browser reports its current page; guests' browsers read it. Guests can look but never change anything.
 */

/** The pages a guest may be pointed at (the first segment of the route). */
export const FOLLOWABLE = ["today", "customers", "inbox", "qr", "outlook", "pilot", "settings"] as const;

export interface FollowState {
  path: string;
  query: string;
  at: number;
}

/** Validate a route reported by the presenter's browser. */
export function parseFollow(body: { path?: unknown; query?: unknown }): { path: string; query: string } | undefined {
  const path = typeof body.path === "string" ? body.path : "";
  const query = typeof body.query === "string" ? body.query : "";
  if (!path.startsWith("/") || path.length > 200 || query.length > 200) return undefined;
  const first = path.split("/").filter(Boolean)[0] ?? "";
  if (!(FOLLOWABLE as readonly string[]).includes(first)) return undefined;
  if (path.includes("..") || !/^[\w\-/.]*$/.test(path) || !/^[\w\-=&%.]*$/.test(query)) return undefined;
  return { path, query };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * True when the request came from this computer. The node server always supplies the connection; a request with none is
 * the test harness calling the app directly, so it counts as local. A connection whose address can't be read is not local.
 */
export function isLocalRequest(env: unknown): boolean {
  const e = env as { server?: { incoming?: { socket?: { remoteAddress?: string } } }; incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  const incoming = e?.server?.incoming ?? e?.incoming;
  if (!incoming) return true;
  const addr = incoming.socket?.remoteAddress;
  return addr !== undefined && LOOPBACK.has(addr);
}

/** This computer's private Wi-Fi/LAN addresses, the ones a phone on the same network can reach. Wi-Fi (en0) comes first. */
export function lanAddresses(): string[] {
  const found: Array<{ name: string; ip: string }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) found.push({ name, ip: i.address });
    }
  }
  const rank = (f: { name: string; ip: string }) => (f.name === "en0" ? 0 : f.ip.startsWith("192.168.") ? 1 : 2);
  return found.sort((a, b) => rank(a) - rank(b)).map((f) => f.ip);
}

/** Where guests should point their phones: FOLLOW_BASE_URL if set (for example a tunnel), else this computer's first LAN address. */
export function followBase(port: number, override = process.env.FOLLOW_BASE_URL): { base: string; urls: string[]; onNetwork: boolean } {
  const urls = lanAddresses().map((ip) => `http://${ip}:${port}`);
  if (override) return { base: override.replace(/\/$/, ""), urls, onNetwork: true };
  return { base: urls[0] ?? `http://localhost:${port}`, urls, onNetwork: urls.length > 0 };
}
