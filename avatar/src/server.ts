import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { ServerPortal } from "@pithagoras/extension-api/server";
import type { Model } from "./model";
import { BadSettings, checkSettings } from "./model-settings";
import { checkVrm, modelName, NAME_MAX, Refused } from "./vrm-file";

/** The largest model taken, in bytes. VRoid's exports are usually 10 to 30 MB. */
export const UPLOAD_MAX = 64 * 1024 * 1024;
/** The largest portrait taken: a 256-pixel PNG is far smaller. */
const PORTRAIT_MAX = 1024 * 1024;
/** The longest stamp a portrait is kept with: what it was drawn with (`portraitStamp` in stage.ts). */
const STAMP_MAX = 200;
/** What every PNG starts with. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A model's id: the sha256 of its file, in hex. */
const ID = /^[0-9a-f]{64}$/;
/** How old a part file has to be to be one an upload cut off by a restart left, not one being written. */
const STALE_MS = 60_000;

/**
 * The 3D Avatar's server half: the models people upload on its page in Settings, kept in its own folder of the
 * portal's data folder (`dataDir()/models`, closed to the agents) and served to the page that draws them. Behind the
 * portal's login, at /api/x/@pithagoras/flair-avatar/…:
 *
 *   GET    /models               { models }: each model, by name
 *   POST   /models?name=<file>   the file as the body (application/octet-stream), at most 64 MiB: checked as a VRM
 *                                model (vrm-file.ts) and kept by its sha256, so the same file is one model. 201 and
 *                                { model } for a new one, 200 and the model there already for one uploaded before
 *   GET    /models/:id/file      the model's file, cached for good: its address is its content's hash
 *   PUT    /models/:id/portrait?stamp=<what it was drawn with>
 *                                a PNG, at most 1 MiB: the picture the Agents page shows (the Settings page makes it),
 *                                kept with its stamp, 1 to 200 characters
 *   GET    /models/:id/portrait  that picture
 *   PATCH  /models/:id           { name }: a new name, 1 to 80 characters
 *   PUT    /models/:id/settings  { settings }: what is set on the model (model-settings.ts), checked, in place of what
 *                                was; {} is every default
 *   DELETE /models/:id           the model, its picture and what is kept of it
 *
 * Each model is three files: `<id>.vrm`, `<id>.json` (the Model, what `GET /models` lists) and `<id>.png`. What is
 * written goes to a `.part` file first and is renamed into place whole. A refusal is JSON, `{ error, code, detail? }`:
 * `error` in English, `code` what the page says it in its own words by.
 */
export default function flairAvatar(portal: ServerPortal) {
  const base = portal.dataDir();
  const dir = path.join(base, "models");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // An upload cut off by a restart leaves its part file: `files.sweepTemp` is for the portal's own saves' names.
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (name.endsWith(".part") && Date.now() - statSync(file).mtimeMs > STALE_MS) rmSync(file, { force: true });
  }

  const where = (id: string, ext: string) => path.join(dir, `${id}.${ext}`);
  const kept = (id: string): Model | undefined => {
    try {
      return JSON.parse(readFileSync(where(id, "json"), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  };
  const keep = (model: Model) => {
    put(where(model.id, "json"), Buffer.from(JSON.stringify(model)));
    return model;
  };
  // The model a request names, or a 404 for an id that is not one or a model that is not there.
  const named = (req: Request, res: Response): Model | undefined => {
    const id = String(req.params.id);
    const model = ID.test(id) ? kept(id) : undefined;
    if (!model) refuse(res, 404, "not-found", "There is no such model");
    return model;
  };
  const send = (req: Request, res: Response, ext: string, options?: { cache: string; mimeType: string }) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return refuse(res, 404, "not-found", "There is no such model");
    let opened;
    try {
      opened = portal.files.open(base, `models/${id}.${ext}`);
    } catch (e) {
      if ((e as { code?: string }).code === "missing") return refuse(res, 404, "not-found", "There is no such model");
      throw e;
    }
    portal.http.send(req, res, options ? { ...opened, mimeType: options.mimeType } : opened, options && { cache: options.cache });
  };

  const router = portal.router;

  router.get("/models", (_req, res) => {
    const models = readdirSync(dir)
      .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
      .map((name) => kept(name.slice(0, 64))!)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ models });
  });

  router.post("/models", async (req, res) => {
    const part = path.join(dir, `upload-${randomBytes(8).toString("hex")}.part`);
    // Read back as well as written: it is checked from its first bytes once it is all there.
    const fd = openSync(part, "wx+", 0o600);
    const hash = createHash("sha256");
    let size = 0;
    let facts: ReturnType<typeof checkVrm> | undefined;
    try {
      const whole = await readBody(req, UPLOAD_MAX, (chunk) => {
        writeSync(fd, chunk);
        hash.update(chunk);
        size += chunk.length;
      });
      if (!whole) return tooLarge(res, "The model is larger than 64 MiB");
      facts = checkVrm((position, length) => {
        const bytes = Buffer.alloc(length);
        readSync(fd, bytes, 0, length, position);
        return bytes;
      }, size);
      fsyncSync(fd);
    } catch (e) {
      if (e instanceof Refused) return refuse(res, 400, e.code, e.message, e.detail);
      throw e;
    } finally {
      closeSync(fd);
      if (!facts) rmSync(part, { force: true });
    }
    const id = hash.digest("hex");
    const { name: own, ...made } = facts;
    const model = (): Model => ({ id, name: modelName(own, fileName(req)), size, added: new Date().toISOString(), ...made });
    if (existsSync(where(id, "vrm"))) {
      rmSync(part, { force: true });
      // Its own file is there already; what is kept of it too, unless a restart came between the two.
      return res.json({ model: kept(id) ?? keep(model()) });
    }
    renameSync(part, where(id, "vrm"));
    res.status(201).json({ model: keep(model()) });
  });

  router.get("/models/:id/file", (req, res) => send(req, res, "vrm", { mimeType: "model/gltf-binary", cache: "private, max-age=31536000, immutable" }));

  router.put("/models/:id/portrait", async (req, res) => {
    const model = named(req, res);
    if (!model) return;
    const stamp = typeof req.query.stamp === "string" ? req.query.stamp : "";
    if (!stamp || stamp.length > STAMP_MAX) return refuse(res, 400, "bad-stamp", `The portrait's stamp must be 1 to ${STAMP_MAX} characters`);
    const chunks: Buffer[] = [];
    if (!(await readBody(req, PORTRAIT_MAX, (chunk) => chunks.push(chunk)))) return tooLarge(res, "The portrait is larger than 1 MiB");
    const png = Buffer.concat(chunks);
    if (!png.subarray(0, PNG.length).equals(PNG)) return refuse(res, 400, "not-png", "The portrait is not a PNG");
    // Read again now that the body is in: what was saved of the model meanwhile (its settings, its name) is kept, and
    // a model deleted meanwhile is not brought back without its file.
    const now = kept(model.id);
    if (!now) return refuse(res, 404, "not-found", "There is no such model");
    put(where(model.id, "png"), png);
    res.json({ model: keep({ ...now, portrait: new Date().toISOString(), portraitStamp: stamp }) });
  });

  router.get("/models/:id/portrait", (req, res) => send(req, res, "png"));

  router.patch("/models/:id", portal.http.json(), (req, res) => {
    const model = named(req, res);
    if (!model) return;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || [...name].length > NAME_MAX) return refuse(res, 400, "bad-name", `The name must be 1 to ${NAME_MAX} characters`);
    res.json({ model: keep({ ...model, name }) });
  });

  router.put("/models/:id/settings", portal.http.json(), (req, res) => {
    const model = named(req, res);
    if (!model) return;
    let settings;
    try {
      settings = checkSettings(req.body?.settings);
    } catch (e) {
      if (e instanceof BadSettings) return refuse(res, 400, e.code, e.message, e.detail);
      throw e;
    }
    res.json({ model: keep({ ...model, settings }) });
  });

  router.delete("/models/:id", (req, res) => {
    const model = named(req, res);
    if (!model) return;
    // What lists it first, so a model is never listed without its file.
    for (const ext of ["json", "vrm", "png"]) rmSync(where(model.id, ext), { force: true });
    res.json({ ok: true });
  });
}

/** The uploaded file's own name, which names a model that gives itself none. */
const fileName = (req: Request) => (typeof req.query.name === "string" ? req.query.name : undefined);

function refuse(res: Response, status: number, code: string, error: string, detail?: string) {
  res.status(status).json({ error, code, ...(detail ? { detail } : {}) });
}

/** Over the cap: said at once, and the connection closed after, so the rest of the body is not read for nothing. */
function tooLarge(res: Response, error: string) {
  res.set("Connection", "close");
  refuse(res, 413, "too-large", error);
}

/**
 * Reads a request's body into `take` as it comes, at most `max` bytes: false at once for a `Content-Length` over it,
 * and as soon as more than that has come, after which nothing more of it is read. Routes read no body by themselves.
 */
function readBody(req: Request, max: number, take: (chunk: Buffer) => void): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > max) return resolve(false);
    let count = 0;
    const stop = () => {
      req.off("data", data);
      req.off("end", end);
      req.pause();
    };
    const data = (chunk: Buffer) => {
      count += chunk.length;
      if (count > max) {
        stop();
        return resolve(false);
      }
      try {
        take(chunk);
      } catch (e) {
        stop();
        reject(e);
      }
    };
    const end = () => resolve(true);
    req.on("data", data);
    req.once("end", end);
    req.once("error", reject);
    // Cut off by the other side: what was written of it is removed by the caller.
    req.once("close", () => req.complete || reject(new Error("The upload was cut off")));
  });
}

/** Writes `bytes` beside `file` and renames it into place, so the file is either what it was or all of the new. */
function put(file: string, bytes: Buffer) {
  const part = `${file}.part`;
  const fd = openSync(part, "w", 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(part, file);
}
