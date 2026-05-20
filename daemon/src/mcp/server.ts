import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown>;
}

export type ToolMap = Map<string, ToolDefinition>;

function zodToJsonSchema(_schema: z.ZodTypeAny): Record<string, unknown> {
  // Minimal placeholder — the MCP SDK does not strictly require a full JSON Schema
  // and any production deployment should swap in zod-to-json-schema. Returning a
  // permissive object schema keeps tool discovery functional in Phase 0.
  return { type: "object" };
}

export async function startMcpServer(tools: ToolMap, version = "0.1.0"): Promise<void> {
  const server = new Server(
    { name: "agentsmith", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.get(req.params.name);
    if (!tool) {
      return { content: [{ type: "text", text: `unknown tool: ${req.params.name}` }], isError: true };
    }
    try {
      const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
      const result = await tool.handler(parsed);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
