import path from "node:path";
import type { ServerPortal } from "@pithagoras/extension-api/server";
import type { Docker } from "../../shared/docker-api";
import { mcpClient } from "../../shared/mcp";
import { proxyUi, uiUpgrade, writesFromHere } from "../../shared/proxy";
import { relay } from "../../shared/relay";
import { service } from "../../shared/service";
import { openStore } from "../../shared/store";
import listed from "../server/tools.json";
import { ACTS, LABELS, PREFIX } from "./labels";
import { godotRoutes } from "./server/routes";
import { displayOf } from "./displays";
import { godotSpec, names } from "./server/spec";

/**
 * Godot's server half: the real Godot editor run in a container of its own through Docker for extensions
 * (`pithagoras-docker`, which this package requires), its MCP tools relayed as this extension's own tools in every
 * chat (shared/relay.ts), its viewer and the editor's stream served through the portal at
 * /api/x/pithagoras-godot/ui/ (shared/proxy.ts), and the routes of its page in Settings (server/routes.ts).
 *
 * Docker's server half starts before this one, and this one is started again whenever Docker is. So it starts
 * without waiting on Docker, and stops without touching the container: a start or a stop of the half is not one of
 * the server's. Every 30 seconds it looks after the container, as Voice does (shared/service.ts). Its token, its card,
 * its screen size and the server's last list of tools are in its own folder (`portal.dataDir()`).
 */
export default function godot(portal: ServerPortal) {
  const data = portal.dataDir();
  const store = openStore(data);
  const at = names();
  const docker = () => portal.extensions.use<Docker>("pithagoras-docker")!;
  const mcp = mcpClient({ url: () => `http://127.0.0.1:${at.port}/mcp`, token: () => store.token() });
  const tools = relay({ portal, prefix: PREFIX, app: "Godot", mcp, labels: LABELS, acts: ACTS, cacheFile: path.join(data, "tools.json"), listed });
  const svc = service({
    portal,
    docker,
    app: "Godot",
    names: at,
    store,
    relay: tools,
    mcp,
    spec: (plan) => godotSpec(plan, { port: at.port, volume: at.volume, image: at.image, display: displayOf(store.setting("display")) }),
  });

  // Before every route: what installs, starts, stops, removes or changes anything comes from the portal's own pages.
  portal.router.use(writesFromHere);
  godotRoutes(portal, portal.router, svc, store, { port: at.port });
  const proxy = { port: () => at.port, token: () => store.token(), notAnswering: "Godot antwortet nicht. / Godot is not answering." };
  portal.router.use("/ui", proxyUi(proxy));
  // The editor's stream is a WebSocket: the portal checks the sign-in and the page, and hands it over here.
  portal.http.upgrade(uiUpgrade(proxy));

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
