/**
 * URL Validation Utility — SSRF Prevention
 *
 * Validates URLs to prevent Server-Side Request Forgery (SSRF) attacks.
 * Rejects URLs pointing to internal/private networks, cloud metadata endpoints,
 * and non-HTTP protocols. Resolves hostnames to IPs and checks the resolved
 * address against blocked ranges.
 */

import dns from "node:dns";

const MAX_URL_LENGTH = 2048;

// ── Private / reserved IPv4 ranges ────────────────────────────────────────

interface Ipv4Range {
  start: number;
  end: number;
}

function ipv4ToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  { start: ipv4ToNum("0.0.0.0"), end: ipv4ToNum("0.255.255.255") },
  { start: ipv4ToNum("10.0.0.0"), end: ipv4ToNum("10.255.255.255") },
  { start: ipv4ToNum("127.0.0.0"), end: ipv4ToNum("127.255.255.255") },
  { start: ipv4ToNum("169.254.0.0"), end: ipv4ToNum("169.254.255.255") },
  { start: ipv4ToNum("172.16.0.0"), end: ipv4ToNum("172.31.255.255") },
  { start: ipv4ToNum("192.168.0.0"), end: ipv4ToNum("192.168.255.255") },
];

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const num = ipv4ToNum(ip);
  return BLOCKED_IPV4_RANGES.some((r) => num >= r.start && num <= r.end);
}

function isBlockedIpv6(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fe80:")) return true;
  if (ip.startsWith("fc00:") || ip.startsWith("fd00:")) return true;
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) return isBlockedIpv4(v4Mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  return isBlockedIpv4(ip) || isBlockedIpv6(ip);
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateUrl(urlString: string): UrlValidationResult {
  if (!urlString || typeof urlString !== "string") {
    return { valid: false, reason: "URL is required" };
  }
  if (urlString.length > MAX_URL_LENGTH) {
    return { valid: false, reason: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` };
  }
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: "Malformed URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: `Disallowed protocol: ${parsed.protocol}` };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { valid: false, reason: "URL must include a hostname" };
  if (BLOCKED_HOSTNAMES.has(hostname)) return { valid: false, reason: "Blocked hostname (cloud metadata)" };
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { valid: false, reason: "URLs pointing to local/internal hosts are not allowed" };
  }
  if (hostname === "[::1]" || hostname === "::1") {
    return { valid: false, reason: "URLs pointing to loopback addresses are not allowed" };
  }
  if (isBlockedIp(hostname)) {
    return { valid: false, reason: "URLs pointing to private/internal networks are not allowed" };
  }
  return { valid: true };
}

export async function validateAndNormalizeUrl(urlString: string): Promise<string> {
  const result = validateUrl(urlString);
  if (!result.valid) throw new Error(result.reason ?? "Invalid URL");
  const parsed = new URL(urlString);
  const hostname = parsed.hostname.toLowerCase();
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[");
  if (!isIpLiteral) {
    try {
      const { address } = await dns.promises.lookup(hostname);
      if (isBlockedIp(address)) {
        throw new Error(`Hostname "${hostname}" resolves to a blocked IP address (${address})`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("resolves to a blocked IP")) throw err;
      throw new Error(`Failed to resolve hostname "${hostname}": ${(err as Error).message}`);
    }
  }
  return parsed.toString();
}
