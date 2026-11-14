import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withTenant } from "./db.js";

/**
 * Register tenant-scoped tools. The tenant id is bound when the per-request
 * server is created (see index.ts) and closed over here — tools never see or
 * accept a tenant id as a parameter, so a model cannot be talked into
 * requesting another tenant's rows. Every query runs inside withTenant(),
 * the only place RLS context is set.
 */
export function registerTools(server: McpServer, tenantId: string): void {
  server.registerTool(
    "notes_list",
    {
      description: "List this tenant's notes. Only rows this tenant owns are ever returned.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50).describe("Max notes to return"),
      },
    },
    async ({ limit }) => {
      const rows = await withTenant(tenantId, async (client) =>
        (
          await client.query(
            "SELECT id, title, created_at FROM notes ORDER BY created_at DESC LIMIT $1",
            [limit],
          )
        ).rows,
      );
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    "notes_create",
    {
      description: "Create a note owned by the calling tenant.",
      inputSchema: {
        title: z.string().min(1).max(200),
        body: z.string().max(10_000).default(""),
      },
    },
    async ({ title, body }) => {
      const rows = await withTenant(tenantId, async (client) =>
        (
          await client.query(
            "INSERT INTO notes (tenant_id, title, body) VALUES (current_setting('app.tenant_id')::uuid, $1, $2) RETURNING id, title, created_at",
            [title, body],
          )
        ).rows,
      );
      return { content: [{ type: "text", text: JSON.stringify(rows[0]) }] };
    },
  );

  server.registerTool(
    "notes_get",
    {
      description:
        "Get one note by id. Rows owned by other tenants are invisible (null), never an error.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const rows = await withTenant(tenantId, async (client) =>
        (await client.query("SELECT id, title, body, created_at FROM notes WHERE id = $1", [id])).rows,
      );
      return { content: [{ type: "text", text: JSON.stringify(rows[0] ?? null) }] };
    },
  );

  server.registerTool(
    "notes_delete",
    {
      description: "Delete one of this tenant's notes. Returns the number of rows deleted (0 or 1).",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const count = await withTenant(tenantId, async (client) =>
        (await client.query("DELETE FROM notes WHERE id = $1", [id])).rowCount ?? 0,
      );
      return { content: [{ type: "text", text: String(count) }] };
    },
  );
}
