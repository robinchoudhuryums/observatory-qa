/**
 * INV-19: every React hook in transcript-viewer.tsx is called before the
 * component's early returns (isLoading / !call guards).
 *
 * A useMemo placed after those returns changed the hook count between the
 * loading render and the loaded render, so every cold open of
 * /transcripts/:id crashed into the ErrorBoundary. The E2E suite only opens a
 * nonexistent call (which never reaches the loaded render), so this static
 * check is the guard. Any hook call after the first early return in this file
 * is a violation — hooks are never valid inside nested callbacks either.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  path.join(here, "../client/src/components/transcripts/transcript-viewer.tsx"),
  "utf8",
);

describe("INV-19: transcript-viewer hooks precede early returns", () => {
  it("has no hook call after the first early return", () => {
    const lines = source.split("\n");
    const firstReturn = lines.findIndex((l) => /^\s*if \((isLoading|!call)\) \{/.test(l));
    assert.ok(firstReturn > 0, "expected an isLoading/!call early-return guard");

    const hookCall = /\buse[A-Z][A-Za-z]*\(/;
    const offenders = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .slice(firstReturn)
      .filter(({ line }) => hookCall.test(line) && !line.startsWith("//") && !line.startsWith("*"));
    assert.deepEqual(offenders, [], "hook calls found after the early return");
  });
});
