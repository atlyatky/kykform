import type { NextFunction, Request, Response } from "express";

function ipv4ToUint32(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const o = m.slice(1).map((x) => Number(x));
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr ?? "32", 10);
  const a = ipv4ToUint32(ip);
  const b = ipv4ToUint32(base.trim());
  if (a === null || b === null) return false;
  if (bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

function ipMatchesRule(ip: string, rule: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  if (r.includes("/")) return inCidr(ip, r);
  return ip === r;
}

export function parseAdminAllowlist(env: string | undefined): string[] {
  if (!env?.trim()) return [];
  return env
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isIpInAllowlist(ip: string, rules: string[]): boolean {
  const clean = ip.replace(/^::ffff:/, "");
  for (const rule of rules) {
    if (ipMatchesRule(clean, rule)) return true;
  }
  return false;
}

/** Yönetim API (auth + /api/forms/*). /api/public/* hariç. */
export function isAdminApiPath(path: string): boolean {
  if (path.startsWith("/api/public/")) return false;
  if (path.startsWith("/api/auth/")) return true;
  if (path === "/api/forms" || path.startsWith("/api/forms/")) return true;
  return false;
}

export function adminNetworkGuard(allowlist: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (allowlist.length === 0) return next();
    if (!isAdminApiPath(req.path)) return next();
    const raw = req.ip || req.socket.remoteAddress || "";
    const ip = raw.replace(/^::ffff:/, "");
    if (isIpInAllowlist(ip, allowlist)) return next();
    return res.status(403).json({ error: "Yönetim işlemleri yalnızca izin verilen ağlardan yapılabilir." });
  };
}
