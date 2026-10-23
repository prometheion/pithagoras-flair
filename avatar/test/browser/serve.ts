import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import express from "express";
import flairAvatar from "../../src/server.ts";
import { stubPortal } from "../stub-portal.ts";

/**
 * What the browser tests are served from (playwright.config.mjs starts it): the test page (harness.html, with
 * harness.tsx built beside it with the React the portal has), the extension's browser half as it is built (web/), and
 * its server half's routes on a stand-in for the portal, with a data folder of its own that `POST /reset` empties.
 */
const HERE = import.meta.dirname;
const PACKAGE = path.resolve(HERE, "../..");
const PORT = Number(process.env.PORT ?? 5297);

await build({
  entryPoints: [path.join(HERE, "harness.tsx")],
  outfile: path.join(HERE, ".build/harness.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  logLevel: "warning",
});

let data = "";
let api: express.Router;
const reset = () => {
  if (data) rmSync(data, { recursive: true, force: true });
  data = mkdtempSync(path.join(tmpdir(), "flair-avatar-browser-"));
  const portal = stubPortal(data);
  flairAvatar(portal);
  api = portal.router;
};
reset();

const app = express()
  .get("/", (_req, res) => res.sendFile(path.join(HERE, "harness.html")))
  .use("/.build", express.static(path.join(HERE, ".build")))
  .use("/web", express.static(path.join(PACKAGE, "web")))
  .post("/reset", (_req, res) => {
    reset();
    res.json({ ok: true });
  })
  .use("/api/x/%40pithagoras/flair-avatar", (req, res, next) => api(req, res, next));

http.createServer(app).listen(PORT, "127.0.0.1", () => console.log(`3D Avatar test page at http://127.0.0.1:${PORT}`));
process.on("exit", () => rmSync(data, { recursive: true, force: true }));
