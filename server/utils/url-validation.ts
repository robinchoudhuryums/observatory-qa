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
 *   5. DNS resolution check — `validateAndNormalizeUrl` (pre-flight) and
 *      `safeFetch` (at connect time, so there is no rebinding window)
 *
 * Outbound requests to tenant-supplied URLs should go through `safeFetch`:
 * `validateUrl` alone cannot see what a DNS name resolves to, and plain
 * `fetch` follows redirects to anywhere.
 */
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";

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
  { start: ipv4ToNum("192.0.2.0"), end: ipv4ToNum("192.0.2.255") }, // TEST-NET-1
  { start: ipv4ToNum("198.18.0.0"), end: ipv4ToNum("198.19.255.255") }, // benchmarking
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

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups (null if not IPv6).
 * Handles `::` compression, a dotted IPv4 tail and a zone id. Needed because
 * the WHATWG URL parser rewrites `[::ffff:169.254.169.254]` to
 * `[::ffff:a9fe:a9fe]`, which a dotted-quad regex never matches.
 */
function parseIpv6(ip: string): number[] | null {
  if (net.isIP(ip) !== 6) return null;
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const v4Tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const n = ipv4ToNum(v4Tail[1]);
    s = s.slice(0, -v4Tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  let groups: string[];
  if (s.includes("::")) {
    const [head, tail] = s.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    groups = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  } else {
    groups = s.split(":");
  }
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g || "0", 16));
}

function embeddedIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isBlockedIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return false;
  // ::/96 — unspecified, loopback and deprecated IPv4-compatible addresses
  if (g.slice(0, 6).every((x) => x === 0)) return true;
  // ::ffff:0:0/96 (IPv4-mapped) and ::ffff:0:0:0/96 (IPv4-translated)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedIpv4(embeddedIpv4(g[6], g[7]));
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) {
    return isBlockedIpv4(embeddedIpv4(g[6], g[7]));
  }
  // 64:ff9b::/96 NAT64 embeds an IPv4 address; 64:ff9b:1::/48 is local-use
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g.slice(2, 6).every((x) => x === 0)) return isBlockedIpv4(embeddedIpv4(g[6], g[7]));
    if (g[2] === 1) return true;
  }
  // 2002::/16 6to4 embeds an IPv4 address in groups 1–2
  if (g[0] === 0x2002) return isBlockedIpv4(embeddedIpv4(g[1], g[2]));
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo (obfuscated IPv4)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Returns true if the IP literal (optionally bracketed) falls in any blocked range. */
export function isBlockedIp(ip: string): boolean {
  const bare = stripBrackets(ip);
  return isBlockedIpv4(bare) || isBlockedIpv6(bare);
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
  // A trailing dot is the same host to DNS ("localhost." resolves like "localhost").
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (!hostname) return { valid: false, reason: "URL must include a hostname" };
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "URL must not contain credentials" };
  }
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
  const hostname = stripBrackets(parsed.hostname.toLowerCase());
  if (net.isIP(hostname) === 0) {
    let addresses: dns.LookupAddress[];
    try {
      addresses = await dns.promises.lookup(hostname, { all: true });
    } catch (err: unknown) {
      throw new Error(`Failed to resolve hostname "${hostname}": ${(err as Error).message}`);
    }
    // Every address must be public: a name with one public and one private
    // A record lets the connection land on either.
    const blocked = addresses.find((a) => isBlockedIp(a.address));
    if (blocked || addresses.length === 0) {
      throw new Error(`Hostname "${hostname}" resolves to a blocked IP address`);
    }
  }
  return parsed.toString();
}

// ── safeFetch: SSRF-safe outbound HTTP ───────────────────────────────────────

/** The target (or a redirect hop, or a resolved address) is not allowed. */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeds ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Abort signal; defaults to a timeout of `timeoutMs`. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Response body cap (bytes). Default 5 MB. */
  maxBytes?: number;
  /**
   * Redirects to follow, each re-validated (default 0: a 3xx is returned
   * unfollowed, like `redirect: "manual"`).
   */
  maxRedirects?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const CROSS_ORIGIN_STRIPPED_HEADERS = ["authorization", "cookie", "proxy-authorization", "x-api-key"];

/**
 * Connect-time DNS lookup that refuses blocked addresses. The address
 * validated is the address connected to, so a DNS answer that changes between
 * a pre-flight check and the request (rebinding) cannot reach an internal host.
 */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses || [];
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
      return callback(new SsrfBlockedError(`Hostname "${hostname}" resolves to a blocked IP address`));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

interface RawResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: Buffer;
}

function requestOnce(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | Buffer;
    signal: AbortSignal;
    maxBytes: number;
  },
): Promise<RawResponse> {
  const check = validateUrl(url);
  if (!check.valid) return Promise.reject(new SsrfBlockedError(check.reason || "URL blocked"));
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  const headers: Record<string, string> = { "accept-encoding": "identity", ...init.headers };
  if (init.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-length")) {
    headers["content-length"] = String(Buffer.byteLength(init.body));
  }

  return new Promise((resolve, reject) => {
    let tooLarge = false;
    const req = transport.request(
      target,
      { method: init.method, headers, signal: init.signal, lookup: guardedLookup as unknown as net.LookupFunction },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (tooLarge) return;
          size += chunk.length;
          if (size > init.maxBytes) {
            // Reject directly and tear down without an error argument: once
            // the response has started, destroy(err) surfaces the error on the
            // socket, where nothing listens, and crashes the process.
            tooLarge = true;
            reject(new ResponseTooLargeError(init.maxBytes));
            res.destroy();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (tooLarge) return;
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((item) => out.append(k, item));
            else if (v !== undefined) out.set(k, String(v));
          }
          resolve({
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            headers: out,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", (err) => {
          if (!tooLarge) reject(err);
        });
      },
    );
    req.on("error", (err: Error) => {
      if (tooLarge) return;
      if (err instanceof SsrfBlockedError || err instanceof ResponseTooLargeError || err.name === "AbortError") {
        reject(err);
      } else {
        // Same shape as fetch(): network failures are TypeError("fetch failed").
        reject(new TypeError("fetch failed", { cause: err }));
      }
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * fetch()-compatible request to a tenant-supplied URL with SSRF protection:
 * validates the URL, refuses blocked addresses at connect time, re-validates
 * every redirect hop (or does not follow redirects at all — the default), and
 * caps the response size. Returns a standard `Response`.
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 0;
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = init.signal ?? AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let current = url;
  let method = (init.method || "GET").toUpperCase();
  let body = init.body;
  let headers = { ...(init.headers || {}) };

  for (let hop = 0; ; hop++) {
    const raw = await requestOnce(current, { method, headers, body, signal, maxBytes });
    const location = raw.headers.get("location");
    if (REDIRECT_STATUSES.has(raw.status) && location && hop < maxRedirects) {
      const next = new URL(location, current);
      if (next.origin !== new URL(current).origin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(([k]) => !CROSS_ORIGIN_STRIPPED_HEADERS.includes(k.toLowerCase())),
        );
      }
      if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-/i.test(k)));
      }
      current = next.toString();
      continue;
    }
    return new Response(NULL_BODY_STATUSES.has(raw.status) ? null : new Uint8Array(raw.body), {
      status: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
    });
  }
}
