import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, extractBearerToken } from "./auth.js";
import { registerTools } from "./tools.js";
import pool, { closePool } from "./db.js";
import { config } from "./config.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

/**
 * MCP endpoint over the streamable HTTP transport, stateless.
 *
 * One McpServer + transport pair is created per request. The tenant id
 * from the bearer token is bound into that pair, so tools have no way to
 * reference any other tenant. No session state is kept between requests.
 */
async function handleMcp(req: express.Request, res: express.Response): Promise<void> {
  const token = extractBearerToken(req.get("authorization"));
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  const tenant = await authenticate(pool, token);
  if (!tenant) {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const server = new McpServer(
    { name: "hyperfya-zero-trust-mcp", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );
  registerTools(server, tenant.id);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no sessions, no SSE
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", (req, res, next) => {
  handleMcp(req, res).catch(next);
});

// Stateless servers do not support GET (SSE streams) or session deletion.
app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "SSE not supported; use HTTP POST" });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "stateless server; nothing to delete" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal error" });
});

const server = app.listen(config.port, () => {
  console.log(`hyperfya zero-trust MCP server listening on :${config.port}`);
});

async function shutdown() {
  server.close();
  await closePool();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
