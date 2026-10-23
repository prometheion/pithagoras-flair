import path from "node:path";
import type { ServerPortal } from "@pithagoras/extension-api/server";
import type { Docker } from "../../shared/docker-api";
import { mcpClient } from "../../shared/mcp";
import { serverProxy } from "../../shared/proxy";
import { relay, type Relay } from "../../shared/relay";
import { service } from "../../shared/service";
import { openStore } from "../../shared/store";
import { LABELS, RUNS_CODE } from "./labels";
import { godotRoutes, type EditorState } from "./server/routes";
import { containerSpec, names } from "./server/spec";

/**
 * Godot's server half: the Godot server's container through Docker (`pithagoras-docker`, which it requires), the
 * server's 27 MCP tools as the extension's own tools in every chat (shared/relay.ts), the server's viewer and its
 * stream through the portal (shared/proxy.ts), and the routes of the Godot page in Settings and of the panel beside each
 * chat, at /api/x/pithagoras-godot/… (server/routes.ts).
 *
 * Docker's server half starts before this one, and this one is started again whenever Docker's is, so it starts
 * without waiting on Docker and stops without touching the container: a start or a stop of the half is not one of the
 * server's (shared/service.ts). Every 30 seconds it looks after the container, as Voice does: one that answers for the
 * first time gives its tools, and a running one made with another spec than the extension's now is made again.
 *
 * Its settings and the server's token are in its own folder (`portal.dataDir()`, settings.json), with the cache of the
 * server's tools (tools.json).
 */
export default function godot(portal: ServerPortal) {
  const dataDir = portal.dataDir();
  const store = openStore(dataDir);
  const at = names();
  const docker = (): Docker => portal.extensions.use<Docker>("pithagoras-docker")!;
  const mcp = mcpClient({ port: () => at.port, token: () => store.token() });

  let tools: Relay | undefined;
  const svc = service({
    docker,
    extension: portal.extension,
    log: (text) => portal.log(text),
    container: at.container,
    volume: at.volume,
    probe: at.probe,
    image: at.image,
    pinned: at.gpu,
    chosen: () => store.setting("gpu") ?? "",
    spec: (plan) => containerSpec({ ...plan, image: at.image, token: store.token(), port: at.port, display: routes.display(), volume: at.volume }),
    ready: () => mcp.ping(),
    onReady: (image) => tools!.refresh(image),
    wasInstalled: () => tools?.known() ?? false,
    // A container that went takes its tools with it; one that came gives them once it answers (`onReady`).
    onInstalled: (installed) => {
      if (!installed) tools?.forget();
      void portal.chats.reload().catch((e) => portal.log(`could not give the chats the Godot tools as they are now: ${(e as Error).message}`));
    },
  });

  tools = relay({
    portal,
    prefix: "godot",
    mcp,
    labels: LABELS,
    acts: Object.fromEntries(RUNS_CODE.map((name) => [name, ["upload" as const]])),
    cacheFile: path.join(dataDir, "tools.json"),
    installed: () => svc.installed(),
    notRunning: "Godot is not running. The person can start it in Settings → Godot.",
  });

  /** The editor as the server says it is, for the page: a server that does not answer in time says nothing. */
  async function editor(): Promise<EditorState | undefined> {
    try {
      const answer = await fetch(`http://127.0.0.1:${at.port}/api/state`, { headers: { authorization: `Bearer ${store.token()}` }, signal: AbortSignal.timeout(2_000) });
      if (!answer.ok) return undefined;
      const { ready, editor, project, renderer, busy, restarts, adapter, godot } = (await answer.json()) as EditorState;
      return { ready, editor, project, renderer, busy, restarts, adapter, godot };
    } catch {
      return undefined;
    }
  }

  const routes = godotRoutes({ portal, router: portal.router, service: svc, store, pinned: at.gpu, editor });
  const proxy = serverProxy({ port: () => at.port, token: () => store.token(), app: "Godot" });
  portal.router.use("/ui", proxy.ui);
  // The editor's stream is a WebSocket: the portal checks the sign-in and the page, and hands it over here.
  portal.http.upgrade(proxy.upgrade);

  let stopped = false;
  const look = () => {
    if (!stopped) void svc.maintain().catch((e) => portal.log(`could not look after the Godot server: ${(e as Error).message}`));
  };
  const timer = setInterval(look, 30_000);
  timer.unref();
  look();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
