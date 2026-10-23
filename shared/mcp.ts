/**
 * A JSON-RPC client for the MCP endpoint of a server in this repository's containers: POST /mcp on the portal's
 * loopback with the server's token. Those servers answer each POST with JSON and keep no session (MCP's Streamable
 * HTTP without its event stream), so this speaks JSON only, the four methods the relay needs: initialize, ping,
 * tools/list and tools/call.
 *
 * A call waits as long as the portal's own fetches do (the portal's dispatcher waits 30 minutes for an answer), which
 * covers a long export or recording. Its AbortSignal ends the request; the server goes on with what it was doing, as
 * neither server reads `notifications/cancelled`.
 */

/** What a tool says it takes and does, as tools/list gives it. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One part of what a tool returned: text, or a picture as base64. */
export type McpPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: string; [key: string]: unknown };

export interface McpResult {
  content: McpPart[];
  isError?: boolean;
}

/** The server did not answer at all: nothing listens on its port, or the connection broke. Not a refusal of its own. */
export class Unreachable extends Error {}

export const PROTOCOL = "2025-06-18";

export function mcpClient(options: { port: () => number; token: () => string; host?: string }) {
  let id = 0;
  const url = () => `http://${options.host ?? "127.0.0.1"}:${options.port()}/mcp`;

  /** One JSON-RPC request: its result, or its error as an Error with the server's message. */
  async function call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    let answer: Response;
    try {
      answer = await fetch(url(), {
        method: "POST",
        headers: { authorization: `Bearer ${options.token()}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Unreachable((e as Error & { cause?: Error }).cause?.message ?? (e as Error).message);
    }
    const text = await answer.text();
    let said: { result?: T; error?: { message?: string } | string };
    try {
      said = JSON.parse(text);
    } catch {
      throw new Error(`The server answered ${answer.status} with something that is not JSON: ${text.slice(0, 200)}`);
    }
    // A JSON-RPC error has a message; a refusal before JSON-RPC (a wrong token: 401) says why as text.
    if (typeof said.error === "object" && said.error) throw new Error(said.error.message ?? `${method} failed`);
    if (!answer.ok) throw new Error(`The server answered ${answer.status}${typeof said.error === "string" ? `: ${said.error}` : ""}`);
    return said.result as T;
  }

  return {
    call,
    /** What the server is and what it tells its clients: its MCP instructions and its version. */
    async initialize(): Promise<{ instructions: string; version: string }> {
      const r = await call<{ instructions?: string; serverInfo?: { version?: string } }>("initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "pithagoras-flair", version: "1" },
      });
      return { instructions: r.instructions ?? "", version: r.serverInfo?.version ?? "" };
    },
    /** Whether the server answers, with this token, within two seconds: the server itself, not the program it runs. */
    async ping(): Promise<boolean> {
      try {
        await call("ping", {}, AbortSignal.timeout(2_000));
        return true;
      } catch {
        return false;
      }
    },
    listTools: async (): Promise<McpTool[]> => (await call<{ tools: McpTool[] }>("tools/list")).tools,
    callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => call<McpResult>("tools/call", { name, arguments: args }, signal),
  };
}

export type McpClient = ReturnType<typeof mcpClient>;
