import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export type Tenant = {
  id: string;
  name: string;
};

/**
 * Extract the bearer token from an Authorization header.
 * Returns null when the header is missing or malformed.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Hash a raw token. Tokens are never stored or compared in plaintext.
 * A leaked database dump must not leak usable credentials.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Look up the tenant that owns a token. Comparison happens in SQL against
 * the stored SHA-256 hash, so plaintext tokens never touch the database.
 */
export async function authenticate(pool: Pool, token: string): Promise<Tenant | null> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM tenants WHERE api_token_hash = $1",
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/**
 * Constant-time string comparison for tokens of equal length.
 * Used by tests to verify hash equality without exposing timing behavior.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
