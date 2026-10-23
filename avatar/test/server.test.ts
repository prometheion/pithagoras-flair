import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import flairAvatar, { UPLOAD_MAX } from "../src/server.ts";
import { stubPortal } from "./stub-portal.ts";
import { tinyVrm0, tinyVrm1 } from "./tiny-vrm.ts";

/** The server half's routes, as its Settings page and the live avatar use them, on a stand-in for the portal. */

const data = mkdtempSync(path.join(tmpdir(), "flair-avatar-routes-"));
after(() => rmSync(data, { recursive: true, force: true }));
const portal = stubPortal(data);
flairAvatar(portal);
const app = express()
  .use("/x", portal.router)
  // What a route did not catch, in JSON with its message, as the portal's own handler says it.
  .use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => void res.status(500).json({ error: err.message }));
const server = http.createServer(app);
server.listen(0, "127.0.0.1");
await once(server, "listening");
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
const { port } = server.address() as AddressInfo;
const at = `http://127.0.0.1:${port}/x`;
const models = path.join(data, "models");

const upload = (bytes: Uint8Array<ArrayBuffer>, name = "tiny.vrm") =>
  fetch(`${at}/models?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const parts = () => readdirSync(models).filter((name) => name.endsWith(".part"));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A request made by hand, for a body the fetch API will not send: its status and what it answered. */
function raw(options: http.RequestOptions, write: (req: http.ClientRequest) => void): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, ...options }, async (res) => {
      let text = "";
      for await (const chunk of res) text += chunk;
      resolve({ status: res.statusCode!, body: JSON.parse(text) });
    });
    // The server stops reading once it has said no: what is still being sent then meets a closed connection.
    req.on("error", (e) => ((e as NodeJS.ErrnoException).code === "EPIPE" || (e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(e)));
    write(req);
  });
}

test("a model is uploaded, kept by its content's hash, and the same file again is the same model", async () => {
  const one = tinyVrm1();
  const first = await upload(one, "Ignored name.vrm");
  assert.equal(first.status, 201);
  const { model } = await first.json();
  assert.equal(model.id, sha256(one));
  assert.equal(model.name, "Tiny", "the model's own name");
  assert.equal(model.spec, "1.0");
  assert.equal(model.size, one.byteLength);
  assert.ok(Date.now() - Date.parse(model.added) < 10_000);
  assert.equal(model.licence.avatarPermission, "everyone");
  assert.deepEqual(readFileSync(path.join(models, `${model.id}.vrm`)), Buffer.from(one));
  assert.equal(statSync(path.join(models, `${model.id}.vrm`)).mode & 0o777, 0o600, "for the portal alone");
  assert.deepEqual(JSON.parse(readFileSync(path.join(models, `${model.id}.json`), "utf8")), model);

  const again = await upload(one, "other.vrm");
  assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).model, model);
  assert.deepEqual(parts(), []);

  const zero = await upload(tinyVrm0());
  assert.equal(zero.status, 201);
  assert.equal((await zero.json()).model.spec, "0.x");
  const listed = await (await fetch(`${at}/models`)).json();
  assert.deepEqual(listed.models.map((m: { name: string }) => m.name), ["Tiny", "Tiny Zero"], "by name");
});

test("a model without a name of its own is named by its file", async () => {
  const answer = await upload(tinyVrm1((json) => (json.extensions.VRMC_vrm.meta.name = "")), "Seed-san.vrm");
  assert.equal((await answer.json()).model.name, "Seed-san");
});

test("a file that is not a model this extension can draw is refused with a code the page translates, and nothing is kept", async () => {
  const before = readdirSync(models).length;
  const cases: [Uint8Array<ArrayBuffer>, string, string?][] = [
    [new TextEncoder().encode("not a model at all, only some text"), "not-glb"],
    [tinyVrm1((json) => (json.extensionsUsed = [])), "not-vrm"],
    [tinyVrm1((json) => delete json.extensions.VRMC_vrm.humanoid.humanBones.leftFoot), "missing-bone", "leftFoot"],
    [tinyVrm1((json) => (json.extensionsRequired = ["KHR_draco_mesh_compression"])), "compressed", "KHR_draco_mesh_compression"],
  ];
  for (const [bytes, code, detail] of cases) {
    const answer = await upload(bytes);
    assert.equal(answer.status, 400, code);
    const said = await answer.json();
    assert.equal(said.code, code);
    assert.equal(said.detail, detail);
    assert.equal(typeof said.error, "string");
  }
  assert.equal(readdirSync(models).length, before);
});

test("a model over 64 MiB is refused as too large, by what its request says and by what it sends, and no part of it is kept", async () => {
  const said = await raw({ method: "POST", path: "/x/models?name=big.vrm", headers: { "content-length": UPLOAD_MAX + 1 } }, (req) => req.flushHeaders());
  assert.equal(said.status, 413);
  assert.equal(said.body.code, "too-large");
  // Sent without a length: refused once more than the cap has come.
  const chunk = Buffer.alloc(1024 * 1024);
  const sent = await raw({ method: "POST", path: "/x/models?name=big.vrm", headers: { "transfer-encoding": "chunked" } }, async (req) => {
    for (let i = 0; i <= 65 && !req.destroyed; i++) if (!req.write(chunk)) await once(req, "drain").catch(() => {});
    req.end();
  });
  assert.equal(sent.status, 413);
  assert.equal(sent.body.code, "too-large");
  assert.deepEqual(parts(), []);
});

test("a model's file is served as a glTF binary, cached for good", async () => {
  const one = tinyVrm1();
  const { model } = await (await upload(one)).json();
  const answer = await fetch(`${at}/models/${model.id}/file`);
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get("content-type"), "model/gltf-binary");
  assert.equal(answer.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.deepEqual(new Uint8Array(await answer.arrayBuffer()), one);
});

test("a portrait is a PNG of at most 1 MiB, kept with the model and served", async () => {
  const { model } = await (await upload(tinyVrm1())).json();
  const put = (body: Uint8Array<ArrayBuffer>) => fetch(`${at}/models/${model.id}/portrait`, { method: "PUT", headers: { "content-type": "image/png" }, body });
  const saved = await put(PNG);
  assert.equal(saved.status, 200);
  const { model: painted } = await saved.json();
  assert.ok(Date.parse(painted.portrait) >= Date.parse(model.added));
  const got = await fetch(`${at}/models/${model.id}/portrait`);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("cache-control"), "private, no-cache");
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG);
  const listed = (await (await fetch(`${at}/models`)).json()).models.find((m: { id: string }) => m.id === model.id);
  assert.equal(listed.portrait, painted.portrait);

  const notPng = await put(new TextEncoder().encode("GIF89a"));
  assert.equal(notPng.status, 400);
  assert.equal((await notPng.json()).code, "not-png");
  const big = await put(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]));
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, "too-large");
});

test("a model is renamed, trimmed, to 1 to 80 characters", async () => {
  const { model } = await (await upload(tinyVrm1())).json();
  const rename = (name: unknown) => fetch(`${at}/models/${model.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const renamed = await rename("  Alicia  ");
  assert.equal((await renamed.json()).model.name, "Alicia");
  assert.equal(JSON.parse(readFileSync(path.join(models, `${model.id}.json`), "utf8")).name, "Alicia");
  for (const bad of ["", "   ", "x".repeat(81), 7]) {
    const answer = await rename(bad);
    assert.equal(answer.status, 400, JSON.stringify(bad));
    assert.equal((await answer.json()).code, "bad-name");
  }
  assert.equal((await (await rename("é".repeat(80))).json()).model.name, "é".repeat(80));
});

test("a model is deleted with its picture and what is kept of it", async () => {
  const { model } = await (await upload(tinyVrm1((json) => (json.extensions.VRMC_vrm.meta.name = "Gone")))).json();
  await fetch(`${at}/models/${model.id}/portrait`, { method: "PUT", body: PNG });
  const gone = await fetch(`${at}/models/${model.id}`, { method: "DELETE" });
  assert.deepEqual(await gone.json(), { ok: true });
  assert.deepEqual(readdirSync(models).filter((name) => name.startsWith(model.id)), []);
  assert.equal((await fetch(`${at}/models/${model.id}/file`)).status, 404);
  assert.equal((await fetch(`${at}/models/${model.id}`, { method: "DELETE" })).status, 404);
});

test("an id that is not a model's is not found, on every route", async () => {
  for (const id of ["nothing", "../models", "a".repeat(63), "A".repeat(64), "b".repeat(64)]) {
    const where = `${at}/models/${encodeURIComponent(id)}`;
    for (const [url, init] of [
      [`${where}/file`, {}],
      [`${where}/portrait`, {}],
      [`${where}/portrait`, { method: "PUT", body: PNG }],
      [where, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"name":"x"}' }],
      [where, { method: "DELETE" }],
    ] as [string, RequestInit][]) {
      const answer = await fetch(url, init);
      assert.equal(answer.status, 404, `${init.method ?? "GET"} ${url}`);
      assert.equal((await answer.json()).code, "not-found");
    }
  }
});

test("a part file an upload cut off by a restart left is removed as the server half starts, and one being written is not", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "flair-avatar-sweep-"));
  after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(path.join(folder, "models"));
  const old = path.join(folder, "models", "upload-0123456789abcdef.part");
  const fresh = path.join(folder, "models", "upload-fedcba9876543210.part");
  writeFileSync(old, "cut off");
  writeFileSync(fresh, "being written");
  utimesSync(old, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  flairAvatar(stubPortal(folder));
  assert.deepEqual(readdirSync(path.join(folder, "models")), ["upload-fedcba9876543210.part"]);
});
