/**
 * Shared helpers and `P` reference for the domain-specific PostgresStorage
 * mixin files under server/db/pg-storage/.
 *
 * Background: PostgresStorage's feature methods used to live in a single
 * 1.7K-LOC `pg-storage-features.ts` file. They're now split by domain
 * (LMS, calibration, revenue, marketing, …) into per-domain mixin files
 * that all attach methods to the shared `P` reference exported here.
 *
 * Each domain file is consumed as a side-effect import from
 * `pg-storage-features.ts` (the barrel) to preserve the historical
 * `import "./pg-storage-features"` semantics.
 */
import { PostgresStorage } from "../pg-storage";
import type { Database } from "../index";

/** Type-safe access to the protected db field. */
export function db(self: PostgresStorage): Database {
  return self["db"];
}

/** Type-safe access to the protected blobClient field. */
export function blob(self: PostgresStorage): PostgresStorage["blobClient"] {
  return self["blobClient"];
}

// `P` is the prototype we attach methods to. The `as any` is structural —
// TypeScript already knows about each method's signature via the IStorage
// interface declared on the class, so the runtime assignments are sound.
// Same pattern the original single-file mixin used.
export const P = PostgresStorage.prototype as any;
