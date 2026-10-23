import path from "node:path";
import type { ServerPortal } from "@pithagoras/extension-api/server";
import type { Docker } from "../../shared/docker-api";
import { mcpClient } from "../../shared/mcp";
import { proxyUi } from "../../shared/proxy";
import { relay } from "../../shared/relay";
import { service } from "../../shared/service";
import { openStore } from "../../shared/store";
import { ACTS, LABELS, PREFIX } from "./labels";
import { blenderRoutes } from "./server/routes";
import { blenderSpec, names } from "./server/spec";

/**
 * Blender's server half: a headless Blender run in a container of its own through Docker for extensions
 * (`pithagoras-docker`, which this package requires), its MCP tools relayed as this extension's own tools in every
 * chat (shared/relay.ts), its viewer served through the portal at /api/x/pithagoras-blender/ui/ (shared/proxy.ts),
 * and the routes of its page in Settings (server/routes.ts).
 *
 * Docker's server half starts before this one, and this one is started again whenever Docker is. So it starts
 * without waiting on Docker, and stops without touching the container: a start or a stop of the half is not one of
 * the server's. Its token, its card and the server's last list of tools are in its own folder (`portal.dataDir()`).
 */
export default function blender(portal: ServerPortal) {
  const data = portal.dataDir();
  const store = openStore(data);
  const at = names();
  const docker = () => portal.extensions.use<Docker>("pithagoras-docker")!;
  const mcp = mcpClient({ url: () => `http://127.0.0.1:${at.port}/mcp`, token: () => store.token() });
  const tools = relay({ portal, prefix: PREFIX, app: "Blender", mcp, labels: LABELS, acts: ACTS, cacheFile: path.join(data, "tools.json") });
  const svc = service({ portal, docker, app: "Blender", names: at, store, relay: tools, mcp, spec: (plan) => blenderSpec(plan, at.port, at.volume, at.image) });

  blenderRoutes(portal, portal.router, svc, { port: at.port, token: () => store.token() });
  // No stream to proxy: the viewer asks for each frame of the viewport with a plain request.
  portal.router.use("/ui", proxyUi({ port: () => at.port, token: () => store.token(), notAnswering: "Blender antwortet nicht. / Blender is not answering." }));

  let stopped = false;
  const look = () => {
    if (!stopped) void svc.maintain().catch((e) => portal.log(`could not look after the Blender server: ${(e as Error).message}`));
  };
  const timer = setInterval(look, 30_000);
  timer.unref();
  look();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
