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
 *
 * Why this is a Proxy and not just `PostgresStorage.prototype`:
 *
 * pg-storage.ts side-effect-imports the mixin chain (pg-storage-features.ts →
 * pg-storage/{calibration,lms,marketing,revenue}.ts), each of which assigns
 * methods to `P` at module-body time. esbuild hoists ALL ESM imports to the
 * top of the bundled `__init` wrapper, so those assignments execute BEFORE
 * pg-storage.ts has reached its `class PostgresStorage` declaration. Reading
 * `PostgresStorage.prototype` here synchronously would (and did) throw
 * `TypeError: Cannot read properties of undefined (reading 'prototype')` on
 * the bundled production server, even though tsx's runtime evaluation order
 * masked it in dev and unit tests.
 *
 * Instead, every `P.foo = fn` is buffered by the Proxy until pg-storage.ts
 * calls `bindPrototype(PostgresStorage.prototype)` at the bottom of its body
 * (after the class is defined and after the mixin chain has finished). The
 * call flushes the buffer onto the real prototype; subsequent assignments
 * (none currently exist) go directly through.
 */
import type { PostgresStorage } from "../pg-storage";
import type { Database } from "../index";

/** Type-safe access to the protected db field. */
export function db(self: PostgresStorage): Database {
  return self["db"];
}

/** Type-safe access to the protected blobClient field. */
export function blob(self: PostgresStorage): PostgresStorage["blobClient"] {
  return self["blobClient"];
}

const _buffer: Record<string, unknown> = {};
let _bound: Record<string, unknown> | null = null;

/**
 * Buffered prototype sink. Mixin files do `P.method = fn` at module-body time
 * and the assignments are queued in `_buffer` until `bindPrototype` flushes
 * them. The `as any` is structural — TypeScript already knows about each
 * method's signature via the IStorage interface declared on the class, so the
 * runtime assignments are sound. Same pattern the original single-file mixin used.
 */
export const P: any = new Proxy(
  {},
  {
    set(_target, prop, value) {
      if (typeof prop !== "string") return false;
      if (_bound) _bound[prop] = value;
      else _buffer[prop] = value;
      return true;
    },
  },
);

/**
 * Flush all buffered mixin methods onto the real PostgresStorage.prototype.
 * Called once from pg-storage.ts after the class is declared. Idempotent:
 * subsequent calls are no-ops because `_buffer` will be empty.
 */
export function bindPrototype(proto: object): void {
  for (const k of Object.keys(_buffer)) {
    (proto as Record<string, unknown>)[k] = _buffer[k];
    delete _buffer[k];
  }
  _bound = proto as Record<string, unknown>;
}
