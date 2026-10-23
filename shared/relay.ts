import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { ServerPortal, ToolGuard } from "@pithagoras/extension-api/server";
import { Unreachable, type McpClient, type McpResult, type McpTool } from "./mcp";

/**
 * The tools of the server in the container, as the extension's own tool group: each tool the server lists over MCP is
 * registered in every chat's pi (`portal.chats.extend`) under the extension's prefix, listed in Settings → Tools under
 * the extension (`portal.tools.offer`), switched per chat, layer and mode there, and held by the guard like any tool.
 * When the extension is switched off or removed the portal drops what it registered, so the tools leave every chat.
 *
 * A chat's pi is extended synchronously as it loads, and a promise its factory returns is not waited for, so nothing
 * can be asked of the server there: the tools come from a cache in the extension's own folder (`tools.json`, 0600),
 * written whenever the server answers with a list or instructions that differ from it. That is what lets a chat that
 * loads after a portal restart, before the container has answered, have its tools at once. A change is handed to the
 * open chats (`portal.chats.reload()`), once.
 *
 * Each call goes to the server's tools/call. What it returns goes to the model as it came: its text parts as text and
 * its pictures (screenshots, renders) as pictures, in order. Nothing is written into the chat's folder: the person
 * sees what the server shows in the panel beside the chat.
 */

/** What the cache holds: the image the server ran in, its MCP instructions, and its tools as it listed them. */
interface Cache {
  image: string;
  instructions: string;
  tools: McpTool[];
}

const EMPTY: Cache = { image: "", instructions: "", tools: [] };

/** A part of a tool's result as pi takes it. */
type Part = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface RelayOptions {
  portal: ServerPortal;
  /** What every tool's name starts with, before an underscore: "godot" makes the server's `ping` into `godot_ping`. */
  prefix: string;
  mcp: McpClient;
  /** What a call's card says of each tool, by its relayed name, in English: the browser half has the German. */
  labels: Record<string, string>;
  /** The guard's rules after a suspected prompt injection that a call of the tool is the shape of, by relayed name. */
  acts: Record<string, NonNullable<ToolGuard["acts"]>>;
  cacheFile: string;
  /** Whether the server's container exists, as the last look found: asked each time a list is drawn or a chat loads. */
  installed: () => boolean;
  /** Said to the model when nothing answers on the server's port. */
  notRunning: string;
}

export function relay(options: RelayOptions) {
  const { portal, prefix, mcp } = options;

  function read(): Cache {
    try {
      const kept = JSON.parse(readFileSync(options.cacheFile, "utf8")) as Partial<Cache>;
      return { image: kept.image ?? "", instructions: kept.instructions ?? "", tools: Array.isArray(kept.tools) ? kept.tools : [] };
    } catch {
      return EMPTY;
    }
  }
  let cache = read();

  /** The model's text of a call that went wrong: its text parts, which is where the server says what. */
  const textOf = (result: McpResult) => result.content.flatMap((p) => (p.type === "text" ? [String(p.text)] : [])).join("\n");

  function definition(tool: McpTool) {
    const name = `${prefix}_${tool.name}`;
    return {
      name,
      label: options.labels[name] ?? name,
      description: tool.description,
      // Both servers describe their arguments in JSON Schema, which is what pi takes.
      parameters: tool.inputSchema,
      // The server's own instructions, which pi says once however many tools carry them.
      ...(cache.instructions ? { promptGuidelines: [cache.instructions] } : {}),
      // One server serves every call in turn, and two edits racing in one editor help nobody.
      executionMode: "sequential",
      // What it returns comes from projects and files that may have come from anywhere: outside content.
      guard: { outside: true, ...(options.acts[name] ? { acts: options.acts[name] } : {}) },
      async execute(_id: string, params: Record<string, unknown> | undefined, signal?: AbortSignal) {
        let result: McpResult;
        try {
          result = await mcp.callTool(tool.name, params ?? {}, signal);
        } catch (e) {
          throw e instanceof Unreachable ? new Error(options.notRunning) : e;
        }
        if (result.isError) throw new Error(textOf(result) || `${name} failed`);
        const content = result.content.flatMap((p): Part[] =>
          p.type === "text" ? [{ type: "text", text: String(p.text) }] : p.type === "image" ? [{ type: "image", data: String(p.data), mimeType: String(p.mimeType) }] : [],
        );
        return { content, details: {} };
      },
    };
  }

  portal.tools.offer(() => (options.installed() ? cache.tools.map((t) => ({ name: `${prefix}_${t.name}`, description: t.description })) : []));
  portal.chats.extend((pi) => {
    if (!options.installed()) return;
    for (const tool of cache.tools) pi.registerTool(definition(tool));
  });

  function keep(next: Cache) {
    writeFileSync(`${options.cacheFile}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(`${options.cacheFile}.tmp`, options.cacheFile);
    cache = next;
  }

  return {
    /** Whether a list of tools is kept: the server answered with one since it was installed. */
    known: () => cache.tools.length > 0,
    tools: () => cache.tools,
    /**
     * Asks the running server for its instructions and its tools, and keeps them. Where either differs from what was
     * kept, the open chats are given the new set. Answers whether they were.
     */
    async refresh(image: string): Promise<boolean> {
      const { instructions } = await mcp.initialize();
      const tools = await mcp.listTools();
      const changed = instructions !== cache.instructions || JSON.stringify(tools) !== JSON.stringify(cache.tools);
      if (changed || image !== cache.image) keep({ image, instructions, tools });
      if (changed) await portal.chats.reload();
      return changed;
    },
    /** The server is gone: its tools are no longer kept, and are offered again only once a new one has answered. */
    forget(): void {
      rmSync(options.cacheFile, { force: true });
      cache = EMPTY;
    },
  };
}

export type Relay = ReturnType<typeof relay>;
