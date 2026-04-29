/**
 * URL validation for SSRF (Server-Side Request Forgery) prevention.
 *
 * One canonical place for SSRF checks. Used by webhook delivery, audit-log
 * exporters, EHR adapters, SSO URLs, RAG URL ingestion — anywhere we make a
 * request to a user-supplied URL.
 *
 * Protection layers:
 *   1. Protocol enforcement (http/https only)
 *   2. URL length cap
 *   3. Hostname blocklist (loopback, cloud metadata, reserved suffixes)
 *   4. Private/reserved IP range blocking (RFC 1918, RFC 6598, link-local,
 *      loopback, multicast, IETF reserved, TEST-NETs)
 *   5. DNS resolution check (prevents DNS rebinding) — `validateAndNormalizeUrl`
 */
import dns from "node:dns";

const MAX_URL_LENGTH = 2048;

// ── Blocked hostnames (cloud metadata + loopback strings) ────────────────────
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
  // AWS metadata
  "169.254.169.254",
  "169.254.169.250",
  // GCP metadata
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.goog",
  "instance-data",
  // Alibaba Cloud metadata
  "100.100.100.200",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".example"];

// ── IPv4 range blocking (numeric comparison) ─────────────────────────────────
interface Ipv4Range {
  start: number;
  end: number;
}

function ipv4ToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  { start: ipv4ToNum("0.0.0.0"), end: ipv4ToNum("0.255.255.255") }, // "this" network
  { start: ipv4ToNum("10.0.0.0"), end: ipv4ToNum("10.255.255.255") }, // RFC 1918
  { start: ipv4ToNum("100.64.0.0"), end: ipv4ToNum("100.127.255.255") }, // RFC 6598 CGNAT
  { start: ipv4ToNum("127.0.0.0"), end: ipv4ToNum("127.255.255.255") }, // loopback
  { start: ipv4ToNum("169.254.0.0"), end: ipv4ToNum("169.254.255.255") }, // link-local
  { start: ipv4ToNum("172.16.0.0"), end: ipv4ToNum("172.31.255.255") }, // RFC 1918
  { start: ipv4ToNum("192.0.0.0"), end: ipv4ToNum("192.0.0.255") }, // IETF assignments
  { start: ipv4ToNum("192.168.0.0"), end: ipv4ToNum("192.168.255.255") }, // RFC 1918
  { start: ipv4ToNum("198.51.100.0"), end: ipv4ToNum("198.51.100.255") }, // TEST-NET-2
  { start: ipv4ToNum("203.0.113.0"), end: ipv4ToNum("203.0.113.255") }, // TEST-NET-3
  { start: ipv4ToNum("224.0.0.0"), end: ipv4ToNum("239.255.255.255") }, // multicast
  { start: ipv4ToNum("240.0.0.0"), end: ipv4ToNum("255.255.255.255") }, // reserved
];

function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isBlockedIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const num = ipv4ToNum(ip);
  return BLOCKED_IPV4_RANGES.some((r) => num >= r.start && num <= r.end);
}

function isBlockedIpv6(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  if (/^fe80:/i.test(ip)) return true; // link-local
  if (/^fc00:/i.test(ip) || /^fd/i.test(ip)) return true; // unique-local
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) return isBlockedIpv4(v4Mapped[1]);
  return false;
}

/** Returns true if the IP literal falls in any blocked range. */
export function isBlockedIp(ip: string): boolean {
  return isBlockedIpv4(ip) || isBlockedIpv6(ip);
}

// ── Public validation API ────────────────────────────────────────────────────

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Synchronous SSRF pre-flight check (no DNS). Validates protocol, hostname,
 * and IP-literal hosts. For full DNS-rebinding-safe validation, follow up
 * with `validateAndNormalizeUrl` before issuing the actual request.
 */
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
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: "URL targets a blocked host (loopback or cloud metadata endpoint)" };
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { valid: false, reason: `URL hostname cannot end with ${suffix}` };
    }
  }
  if (isBlockedIp(hostname)) {
    return { valid: false, reason: "URL targets a private/reserved IP range" };
  }
  return { valid: true };
}

/**
 * Convenience boolean wrapper used by call sites that don't need the reason.
 */
export function isUrlSafe(urlString: string): boolean {
  return validateUrl(urlString).valid;
}

/**
 * Async SSRF check that also resolves the hostname and verifies the resolved
 * IP is not in a blocked range — defends against DNS rebinding.
 *
 * Returns the canonicalized URL string. Throws on any check failure.
 */
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
