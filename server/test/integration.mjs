import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const DB_PASS = "apppass";
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pgc = new EmbeddedPostgres({
  databaseDir: "/tmp/embpg/data",
  user: "postgres",
  password: "postgres",
  port: 5433,
  persistent: false,
});
await pgc.initialise();
await pgc.start();

// Apply init.sh + schema.sql logic as the superuser.
const superPool = new pg.Pool({ connectionString: "postgres://postgres:postgres@localhost:5433/postgres" });
await superPool.query(`CREATE DATABASE mcp`);
await superPool.end();
const mcpSuper = new pg.Pool({ connectionString: "postgres://postgres:postgres@localhost:5433/mcp" });
await mcpSuper.query(`CREATE ROLE mcp_app LOGIN PASSWORD '${DB_PASS}'`);
const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
await mcpSuper.query(schema);
console.log("schema applied");
await mcpSuper.end();

// Boot the built server as mcp_app.
const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: "3100", DATABASE_URL: `postgres://mcp_app:${DB_PASS}@localhost:5433/mcp` },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise((r) => server.stdout.on("data", (d) => /listening/.test(d) && r()) || r());

// Wait for listening log line
await new Promise((r) => setTimeout(r, 500));

const BASE = "http://localhost:3100/mcp";
const j = (body) => ({ "content-type": "application/json", accept: "application/json, text/event-stream", ...body });
async function mcp(token, method, params, id = 1) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: j(token ? { authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

// 1. No token -> 401
check("no token rejected", (await mcp(null, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).status === 401);

// 2. Bogus token -> 401
check("bogus token rejected", (await mcp("hyf_deadbeef", "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).status === 401);

// 3. Issue tokens for two tenants (same SQL the issue-token script runs)
const { createHash } = await import("node:crypto");
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const appPool = new pg.Pool({ connectionString: `postgres://mcp_app:${DB_PASS}@localhost:5433/mcp` });
const tokenA = "hyf_" + "a".repeat(48);
const tokenB = "hyf_" + "b".repeat(48);
await appPool.query(`INSERT INTO tenants (name, api_token_hash) VALUES ('alpha', $1), ('beta', $2)`, [sha(tokenA), sha(tokenB)]);

// 4. initialize with a real token
const init = await mcp(tokenA, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
check("initialize with valid token", init.status === 200 && init.body?.result?.serverInfo?.name === "hyperfya-zero-trust-mcp", JSON.stringify(init.body).slice(0, 120));

// 5. Tenant A creates a note
const created = await mcp(tokenA, "tools/call", { name: "notes_create", arguments: { title: "alpha secret", body: "only alpha sees this" } }, 2);
const noteId = created.body?.result?.content ? JSON.parse(created.body.result.content[0].text).id : null;
check("tenant A creates note", !!noteId, JSON.stringify(created.body).slice(0, 200));

// 6. Tenant A sees its note
const listA = await mcp(tokenA, "tools/call", { name: "notes_list", arguments: {} }, 3);
const rowsA = JSON.parse(listA.body.result.content[0].text);
check("tenant A lists own note", rowsA.length === 1 && rowsA[0].title === "alpha secret");

// 7. Tenant B sees NOTHING — the core RLS guarantee
const listB = await mcp(tokenB, "tools/call", { name: "notes_list", arguments: {} }, 4);
const rowsB = JSON.parse(listB.body.result.content[0].text);
check("tenant B sees zero rows (RLS)", rowsB.length === 0);

// 8. Tenant B cannot fetch A's note by id
const getB = await mcp(tokenB, "tools/call", { name: "notes_get", arguments: { id: noteId } }, 5);
check("tenant B cannot read A's note by id", JSON.parse(getB.body.result.content[0].text) === null);

// 9. Tenant B cannot delete A's note
const delB = await mcp(tokenB, "tools/call", { name: "notes_delete", arguments: { id: noteId } }, 6);
check("tenant B cannot delete A's note", JSON.parse(delB.body.result.content[0].text) === 0);

// 10. Fail-closed: query without RLS context throws
let threw = false;
{
  const c = await appPool.connect();
  try {
    await c.query("SELECT count(*) FROM notes");
  } catch { threw = true; } finally { c.release(); }
}
check("query without tenant context fails closed", threw);

// 11. Superuser sanity: row exists in table
const sup = new pg.Pool({ connectionString: "postgres://postgres:postgres@localhost:5433/mcp" });
const cnt = (await sup.query("SELECT count(*) FROM notes")).rows[0].count;
check("row really exists (count via superuser)", Number(cnt) === 1, `count=${cnt}`);
await sup.end();

server.kill();
await appPool.end();
await pgc.stop();

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
