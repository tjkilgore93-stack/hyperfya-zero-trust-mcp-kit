import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Run queries as a tenant inside a transaction with RLS scoping.
 *
 * Postgres row-level security is enforced by the database, not by this
 * code: every statement in `fn` runs with `app.tenant_id` set to the
 * authenticated tenant, and every policy on every table compares against
 * it. If a policy is missing, `current_setting` throws and the
 * transaction fails closed.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      // true = transaction-scoped; reverts automatically at COMMIT/ROLLBACK.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}

export default pool;
