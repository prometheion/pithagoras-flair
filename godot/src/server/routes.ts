import type { Response, Router } from "express";
import type { ServerPortal } from "@pithagoras/extension-api/server";
import type { Service } from "../../../shared/service";
import type { Store } from "../../../shared/store";
import { DEFAULT_DISPLAY, DISPLAYS, type Display } from "./spec";

/**
 * The Godot page in Settings, and the panel beside each chat, at /api/x/pithagoras-godot/…, behind the portal's
 * sign-in. Voice's names:
 *
 *   GET  /state       how the server stands (service.ts), the editor's own state while it runs, the card, the screen
 *   GET  /hardware    the GPUs, which is pinned, chosen and held
 *   PUT  /gpu         {gpu}: the card, by UUID, or "" for the one with the most free memory. A running server is made
 *                     again on it now, a stopped one at its next Start
 *   PUT  /display     {display}: the size of the virtual screen; a running editor is made again with it
 *   POST /install, /start, /stop
 *   POST /uninstall   {removeData}: the container, and with removeData the projects' volume
 *   /ui/…             the viewer and its stream (server.ts, the proxy)
 */

/** The editor as the server says it is (its /api/state), without its activity log, which is the viewer's. */
export interface EditorState {
  ready: boolean;
  editor: string;
  project: string | null;
  renderer: string | null;
  busy: string | null;
  restarts: number;
  adapter: string | null;
  godot: string;
}

const fail = (res: Response, status: number, e: unknown) => void res.status(status).json({ error: (e as Error).message });

export function godotRoutes(options: { portal: ServerPortal; router: Router; service: Service; store: Store; pinned?: string; editor: () => Promise<EditorState | undefined> }) {
  const { router, service, store } = options;
  const json = options.portal.http.json();
  const display = (): Display => (DISPLAYS as readonly string[]).includes(store.setting("display") ?? "") ? (store.setting("display") as Display) : DEFAULT_DISPLAY;

  router.get("/state", async (_req, res) => {
    try {
      const status = await service.status();
      const editor = status.state === "running" ? await options.editor() : undefined;
      res.json({ ...status, editor, display: display(), chosen: store.setting("gpu") ?? "", pinned: options.pinned ?? "" });
    } catch (e) {
      fail(res, 503, e);
    }
  });
  router.get("/hardware", async (_req, res) => {
    try {
      res.json(await service.hardware());
    } catch (e) {
      fail(res, 503, e);
    }
  });
  /** A setting that the container is made with: saved, and a running server is made again with it now. */
  const remake = async (res: Response, patch: Parameters<Store["put"]>[0]) => {
    store.put(patch);
    const running = ["running", "starting"].includes((await service.status()).state);
    if (running) await service.start();
    res.json({ ok: true, restarting: running });
  };
  router.put("/gpu", json, async (req, res) => {
    const gpu = req.body?.gpu;
    if (options.pinned) return fail(res, 409, new Error("The host pins the GPU for Godot, so it cannot be chosen here."));
    if (typeof gpu !== "string") return fail(res, 400, new Error("Choose a GPU by its UUID, or automatic."));
    try {
      if (gpu && !(await service.hardware()).cards.some((c) => c.uuid === gpu)) return fail(res, 400, new Error("That GPU is not on this host."));
      await remake(res, { gpu });
    } catch (e) {
      fail(res, 400, e);
    }
  });
  router.put("/display", json, async (req, res) => {
    const size = req.body?.display;
    if (!(DISPLAYS as readonly string[]).includes(size)) return fail(res, 400, new Error("Choose one of the screen sizes offered."));
    try {
      await remake(res, { display: size });
    } catch (e) {
      fail(res, 400, e);
    }
  });
  for (const action of ["install", "start", "stop"] as const) {
    router.post(`/${action}`, async (_req, res) => {
      try {
        await service[action]();
        res.json({ ok: true });
      } catch (e) {
        fail(res, 400, e);
      }
    });
  }
  router.post("/uninstall", json, async (req, res) => {
    const removeData = req.body?.removeData ?? false;
    if (typeof removeData !== "boolean") return fail(res, 400, new Error("removeData must be true or false"));
    try {
      await service.uninstall(removeData);
      res.json({ ok: true });
    } catch (e) {
      fail(res, 400, e);
    }
  });
  return { display };
}
