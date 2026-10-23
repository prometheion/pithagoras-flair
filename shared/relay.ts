import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { ServerPortal, ToolGuard } from "@pithagoras/extension-api/server";
import { NotAnswering, type McpClient, type McpTool } from "./mcp";

/**
 * The server's MCP tools as the extension's own: registered in every chat's pi (`portal.chats.extend`), listed in
 * Settings → Tools under the package's group (`portal.tools.offer`), switched there per chat, agent, project and mode
 * as any tool is, held by the guard to what each declares, and gone with the extension when it is switched off or
 * removed, as the portal drops what a package registered.
 *
 * A chat's pi is loaded synchronously and is not waited for, so nothing is asked of the server while a chat loads:
 * the tools are registered from what the server last listed, kept in `tools.json` in the extension's own folder. A
 * chat loaded after a portal restart, before the server answers again, has them at once. When the server answers
 * (the service's look every 30 seconds, and after an install or a start) its list is asked for again, and where it
 * changed, the open chats are loaded again once, each then having the tools as they are now.
 *
 * Each tool is named `<prefix>_<the server's name>`: off pi's own names, off the browser's rules, which a name with
 * `browser_` in it is held to, and grouped by eye. What it is told to the model is the server's own: its description,
 * its schema, and the server's MCP instructions as a guideline, which pi prints once however many tools carry it.
 * One call at a time (`sequential`): one server serves every call, on one thread. What a call returns is outside
 * content (`outside`): it comes from a scene or a project, which may have come from anywhere.
 */

/** What is kept of the server's list, in `tools.json`. */
interface Cache {
  instructions: string;
  tools: McpTool[];
}

/** A tool's result as pi takes it: text and pictures in the order the server gave them. */
type Part = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface RelayOptions {
  portal: ServerPortal;
  /** What the tools' names start with, before `_`: `blender`. */
  prefix: string;
  /** The app's name, as the model is told it is not running: `Blender`. */
  app: string;
  mcp: McpClient;
  /** What each tool's call is labelled with in pi, by the server's name for it. One not listed is labelled with its name. */
  labels: Record<string, string>;
  /** The guard rules every call of a tool is the shape of, by the server's name for it (see ToolGuard.acts). */
  acts: Record<string, NonNullable<ToolGuard["acts"]>>;
  /** Where the list is kept: `tools.json` in the extension's own folder. */
  cacheFile: string;
}

export function relay(options: RelayOptions) {
  const { portal, prefix, mcp, cacheFile } = options;
  const read = (): Cache | undefined => {
    try {
      const kept = JSON.parse(readFileSync(cacheFile, "utf8")) as Cache;
      return Array.isArray(kept.tools) ? kept : undefined;
    } catch {
      return undefined;
    }
  };
  let cache = read();
  /**
   * Whether the server's container exists, as the service last found it. Until it has looked, a kept list says so:
   * the list is kept while there is a server, and deleted when it is removed on the page.
   */
  let installed = cache !== undefined;
  const notRunning = `${options.app} is not running. The person can start it in Settings → ${options.app}.`;

  /** A tool's result, from what the server answered: a result it marks as an error is thrown, so pi marks the call failed. */
  function partsOf(result: Awaited<ReturnType<McpClient["callTool"]>>): Part[] {
    const parts: Part[] = [];
    for (const part of result.content ?? []) {
      if (part.type === "text") parts.push({ type: "text", text: String(part.text) });
      else if (part.type === "image") parts.push({ type: "image", data: String(part.data), mimeType: String(part.mimeType) });
    }
    if (result.isError) throw new Error(parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n") || `${options.app} refused the call`);
    return parts;
  }

  function register(pi: any): void {
    if (!installed || !cache) return;
    const guideline = cache.instructions.trim();
    for (const tool of cache.tools) {
      const acts = options.acts[tool.name];
      const guard: ToolGuard = { outside: true, ...(acts ? { acts } : {}) };
      pi.registerTool({
        name: `${prefix}_${tool.name}`,
        label: options.labels[tool.name] ?? tool.name,
        description: tool.description ?? "",
        parameters: tool.inputSchema,
        ...(guideline ? { promptGuidelines: [guideline] } : {}),
        executionMode: "sequential",
        guard,
        async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal) {
          let result;
          try {
            result = await mcp.callTool(tool.name, params ?? {}, signal);
          } catch (e) {
            if (e instanceof NotAnswering) throw new Error(notRunning);
            throw e;
          }
          return { content: partsOf(result), details: {} };
        },
      });
    }
  }

  portal.tools.offer(() => (installed && cache ? cache.tools.map((t) => ({ name: `${prefix}_${t.name}`, description: t.description ?? "" })) : []));
  portal.chats.extend((pi) => register(pi));

  const reload = () =>
    void portal.chats.reload().catch((e) => portal.log(`could not give the open chats ${options.app}'s tools: ${(e as Error).message}`));

  return {
    /** The tools as they are registered now, by the server's names: for the routes and the tests. */
    tools: () => (installed && cache ? cache.tools.map((t) => t.name) : []),
    /**
     * Whether the server's container exists, as the service found it. A change hands the open chats the tools, or
     * takes them away.
     */
    setInstalled(now: boolean): void {
      if (now === installed) return;
      installed = now;
      if (cache) reload();
    },
    /**
     * The server answers: its list and its instructions asked for again, and kept where they changed, which loads the
     * open chats again once.
     */
    async refresh(): Promise<void> {
      const [info, tools] = await Promise.all([mcp.initialize(), mcp.listTools()]);
      const next: Cache = { instructions: info.instructions, tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
      if (cache && JSON.stringify(cache) === JSON.stringify(next)) return;
      cache = next;
      writeFileSync(`${cacheFile}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${cacheFile}.tmp`, cacheFile);
      if (installed) reload();
    },
    /** The server is removed: nothing is offered or registered any more, and the open chats are loaded again without the tools. */
    forget(): void {
      const had = installed && cache !== undefined;
      cache = undefined;
      installed = false;
      rmSync(cacheFile, { force: true });
      if (had) reload();
    },
  };
}

export type Relay = ReturnType<typeof relay>;
