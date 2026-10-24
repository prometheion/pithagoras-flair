import { createReadStream, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import express from "express";
import type { ServerPortal } from "@pithagoras/extension-api/server";

/**
 * The part of the portal the server half uses, standing in for it in a test: a real express Router, the portal's
 * JSON body parser, its data folder (`data`, a folder of the test's), `files.open` reading the file named and saying a
 * PNG is one, and `http.send` writing it with the headers the portal's own sends. What the portal checks beyond that
 * (paths, links, its login) is the portal's, and tested there.
 */
export function stubPortal(data: string): ServerPortal {
  const router = express.Router();
  const portal = {
    version: 1,
    extension: "@pithagoras/flair-avatar",
    router,
    dataDir: () => data,
    log: () => {},
    http: {
      json: express.json,
      raw: express.raw,
      text: express.text,
      send(_req: express.Request, res: express.Response, file: { fd: number; size: number; name: string; mimeType?: string }, options?: { cache?: string }) {
        res.setHeader("Content-Type", file.mimeType ?? "application/octet-stream");
        if (!file.mimeType) res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
        res.setHeader("Cache-Control", options?.cache ?? "private, no-cache");
        res.setHeader("Content-Length", file.size);
        createReadStream("", { fd: file.fd, start: 0 }).pipe(res);
      },
    },
    files: {
      open(base: string, rel: string) {
        let fd: number;
        try {
          fd = openSync(path.join(base, rel), "r");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") throw Object.assign(new Error(`${rel} is not there`), { code: "missing" });
          throw e;
        }
        const stat = fstatSync(fd);
        const head = Buffer.alloc(8);
        readSync(fd, head, 0, 8, 0);
        const png = head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        return { fd, size: stat.size, name: path.basename(rel), mtime: stat.mtimeMs, change: String(stat.mtimeMs), ...(png ? { mimeType: "image/png" } : {}) };
      },
    },
  };
  return portal as unknown as ServerPortal;
}
