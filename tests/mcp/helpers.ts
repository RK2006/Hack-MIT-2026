import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createContextGraphMcpServer, type McpDeps } from '../../src/server/mcp/server';

/** Connect an MCP client to the server over linked in-memory transports. */
export async function connectMcp(deps: McpDeps) {
  const server = createContextGraphMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export type ToolCall = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

export const textOf = (result: ToolCall) => result.content[0]?.text ?? '';
