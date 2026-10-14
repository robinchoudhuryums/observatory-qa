/**
 * F129: the HIPAA idle auto-logout must actually end the server session.
 *
 * POST /api/auth/logout is CSRF-protected (not in the csrf.ts exempt list).
 * The idle hook used a raw fetch() with no X-CSRF-Token, got a 403, then
 * cleared client state and redirected — the server session survived, kept
 * alive by dashboard polling. Every client call to the logout endpoint must
 * go through a CSRF-aware helper (csrfFetch / apiRequest).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.join(here, "../client/src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("F129: logout requests carry the CSRF token", () => {
  it("the idle-timeout hook logs out via csrfFetch and drops cached queries", () => {
    const src = readFileSync(path.join(clientSrc, "hooks/use-idle-timeout.ts"), "utf8");
    assert.match(src, /csrfFetch\(\s*["']\/api\/auth\/logout["']/);
    assert.match(src, /queryClient\.clear\(\)/, "cached API responses (PHI) must be cleared on idle logout");
  });

  it("no client file posts to /api/auth/logout with a raw fetch()", () => {
    const offenders = walk(clientSrc).filter((file) =>
      /(?<![A-Za-z])fetch\(\s*["'`]\/api\/auth\/logout/.test(readFileSync(file, "utf8")),
    );
    assert.deepEqual(offenders, []);
  });
});
