/**
 * Database connection management.
 *
 * Connects to PostgreSQL via DATABASE_URL env var.
 * Falls back gracefully when not configured (existing S3/memory backends still work).
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { logger } from "../services/logger";

export type Database = NodePgDatabase<typeof schema>;

let db: Database | null = null;
let pool: pg.Pool | null = null;

export function getDatabase(): Database | null {
  return db;
}

/**
 * Direct access to the underlying pg Pool. Needed by schema sync to acquire a
 * dedicated client whose session-level state (e.g. set_config without a transaction)
 * can be safely destroyed with client.release(true) instead of leaking back to the
 * pool. See `syncSchema` in db/sync-schema.ts.
 */
export function getPool(): pg.Pool | null {
  return pool;
}

export async function initDatabase(): Promise<Database | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — PostgreSQL storage backend unavailable");
    return null;
  }

  try {
    const maxConnections = parseInt(process.env.DB_POOL_MAX || "50", 10);
    // HIPAA: Force SSL in production.
    // rejectUnauthorized defaults to true for proper certificate verification.
    // Set DB_SSL_REJECT_UNAUTHORIZED=false only for managed databases (e.g., Neon, Render)
    // that use self-signed certificates not in the system CA store.
    //
    // Exception: loopback hosts (localhost / 127.0.0.1 / 0.0.0.0) — these only
    // exist in CI E2E and dev fixtures, where the local Postgres is plain TCP
    // and forcing SSL would fail the handshake. Real production deployments
    // never connect to the database over loopback plain TCP, so the carve-out
    // can't weaken a real prod posture.
    let sslConfig: pg.PoolConfig["ssl"] = undefined;
    if (process.env.NODE_ENV === "production") {
      let isLoopback = false;
      try {
        const host = new URL(databaseUrl).hostname;
        isLoopback = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
      } catch {
        /* malformed URL — fall through to require SSL, pool will surface the parse error */
      }
      if (!isLoopback) {
        sslConfig = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" };
      }
    }
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Math.min(Math.max(maxConnections, 5), 200),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: sslConfig,
    });

    // Verify the connection
    const client = await pool.connect();
    client.release();

    db = drizzle(pool, { schema });
    logger.info({ poolMax: pool.options.max }, "PostgreSQL database connected");
    return db;
  } catch (error) {
    logger.error({ err: error }, "Failed to connect to PostgreSQL");
    return null;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logger.info("PostgreSQL connection pool closed");
  }
}
