import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sql: NeonQueryFunction<false, false> | undefined;

// Reading configuration and constructing the client happen only on first use.
// Neon sends an HTTP request only when the returned client executes a query.
export function getDb() {
  if (sql) return sql;

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("[database] DATABASE_URL is not configured.");
    throw new Error("Database is not configured.");
  }

  try {
    sql = neon(databaseUrl);
    return sql;
  } catch {
    // Driver errors can include the connection string. Never log the raw error.
    console.error("[database] Failed to initialize the database client.");
    throw new Error("Database is unavailable.");
  }
}
