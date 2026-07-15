import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../src/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,mcp-session-id,Last-Event-ID,mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id,mcp-protocol-version");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }
}
