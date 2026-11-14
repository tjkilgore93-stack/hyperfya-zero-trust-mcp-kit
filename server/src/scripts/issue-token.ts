import { randomBytes } from "node:crypto";
import pool from "../db.js";
import { hashToken } from "../auth.js";

/**
 * Issue an API token for a tenant.
 *
 * Usage: node dist/scripts/issue-token.js <tenant-name>
 * Creates the tenant (or rotates its token if it exists) and prints the
 * plaintext token once. Only the SHA-256 hash is stored.
 */
const [name] = process.argv.slice(2);
if (!name) {
  console.error("Usage: node dist/scripts/issue-token.js <tenant-name>");
  process.exit(1);
}

const token = `hyf_${randomBytes(24).toString("hex")}`;

const { rows } = await pool.query<{ id: string }>(
  `INSERT INTO tenants (name, api_token_hash)
   VALUES ($1, $2)
   ON CONFLICT (name) DO UPDATE SET api_token_hash = EXCLUDED.api_token_hash
   RETURNING id`,
  [name, hashToken(token)],
);

console.log(`tenant: ${name} (${rows[0].id})`);
console.log(`token:  ${token}`);
console.log(`\nStore this token now — it cannot be shown again.`);

await pool.end();
