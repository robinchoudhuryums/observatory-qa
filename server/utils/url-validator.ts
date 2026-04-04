/**
 * URL validation for SSRF (Server-Side Request Forgery) prevention.
 *
 * Adapted from the Call Analyzer for multi-tenant Observatory QA.
 * Used by webhook registration/delivery and any feature making HTTP
 * requests to user-supplied URLs (EHR endpoints, SSO URLs, etc.).
 *
 * Protection layers:
 *   1. Protocol enforcement (HTTPS only in production)
 *   2. Hostname blocklist (localhost, metadata endpoints, .local, .internal)
 *   3. Private/reserved IP range blocking (RFC 1918, RFC 6598, link-local, loopback)
 *   4. DNS resolution check (prevents DNS rebinding — resolves then validates IP)
 */
import { lookup } from "dns/promises";

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
  "metadata.goog",
  // Azure metadata (same IP as AWS)
  // Alibaba Cloud metadata
  "100.100.100.200",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".example"];

function isPrivateOrReservedIP(ip: string): boolean {
  // IPv4 checks
  if (/^127\./.test(ip)) return true;                              // Loopback
  if (/^10\./.test(ip)) return true;                               // RFC 1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;         // RFC 1918
  if (/^192\.168\./.test(ip)) return true;                         // RFC 1918
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip)) return true; // RFC 6598
  if (/^169\.254\./.test(ip)) return true;                         // Link-local
  if (/^0\./.test(ip)) return true;                                // "This" network
  if (/^192\.0\.0\./.test(ip)) return true;                        // IETF assignments
  if (/^198\.51\.100\./.test(ip)) return true;                     // TEST-NET-2
  if (/^203\.0\.113\./.test(ip)) return true;                      // TEST-NET-3
  if (/^(22[4-9]|23\d|24\d|25[0-5])\./.test(ip)) return true;    // Multicast + reserved

  // IPv6 checks
  if (ip === "::1" || ip === "::") return true;                    // Loopback + unspecified
  if (/^fe80:/i.test(ip)) return true;                             // Link-local
  if (/^fc00:/i.test(ip) || /^fd/i.test(ip)) return true;         // Unique local
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateOrReservedIP(v4mapped[1]);

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  resolvedIp?: string;
}

/**
 * Validate a URL for SSRF safety. Call before making any request to a user-supplied URL.
 */
export async function validateUrlForSSRF(
  url: string,
  options: { requireHttps?: boolean; skipDnsCheck?: boolean } = {},
): Promise<UrlValidationResult> {
  const requireHttps = options.requireHttps ?? (process.env.NODE_ENV === "production");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (requireHttps && parsed.protocol !== "https:") {
    return { valid: false, error: "URL must use HTTPS in production" };
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return { valid: false, error: "URL must use http:// or https://" };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: "URL targets a blocked host (localhost, metadata endpoint, or reserved address)" };
  }

  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { valid: false, error: `URL hostname cannot end with ${suffix}` };
    }
  }

  if (isPrivateOrReservedIP(hostname)) {
    return { valid: false, error: "URL targets a private or reserved IP range" };
  }

  // DNS resolution check (prevents DNS rebinding)
  if (!options.skipDnsCheck) {
    try {
      const result = await lookup(hostname, { all: true });
      for (const entry of result) {
        if (isPrivateOrReservedIP(entry.address)) {
          return {
            valid: false,
            error: `URL hostname resolves to private/reserved IP ${entry.address}`,
            resolvedIp: entry.address,
          };
        }
      }
      return { valid: true, resolvedIp: result[0]?.address };
    } catch {
      return { valid: false, error: "URL hostname could not be resolved" };
    }
  }

  return { valid: true };
}

/**
 * Synchronous URL pre-flight check (no DNS). Use for quick validation;
 * always follow up with full async validateUrlForSSRF before making a request.
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) return false;
    for (const suffix of BLOCKED_SUFFIXES) {
      if (hostname.endsWith(suffix)) return false;
    }
    if (isPrivateOrReservedIP(hostname)) return false;
    if (!["https:", "http:"].includes(parsed.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Export for testing */
export const _testExports = { isPrivateOrReservedIP };
