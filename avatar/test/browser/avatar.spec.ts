import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { tinyVrm0, tinyVrm1 } from "../tiny-vrm.ts";
import { sample } from "./fetch-models.ts";

/**
 * The 3D Avatar as voice mode draws it, on the extension's test page: one avatar offered for each model, the model
 * drawn live in the orb's box with the made-up voice of the portal's Avatar dialog, and the orb wherever the model is
 * not drawn. What the drawing does is read from WebGL itself: the calls three.js makes (counted on the context's
 * prototype from before the page loads) and the pixels of the frame it drew.
 */

const API = "/api/x/%40pithagoras/flair-avatar";
// A 1-pixel PNG, for a portrait.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function upload(request: APIRequestContext, bytes: Uint8Array, name = "model.vrm") {
  const answer = await request.post(`${API}/models?name=${encodeURIComponent(name)}`, { data: Buffer.from(bytes), headers: { "content-type": "application/octet-stream" } });
  expect(answer.status()).toBeLessThan(300);
  return (await answer.json()).model as { id: string; name: string };
}

/** The page, from an empty data folder with `models` uploaded, once the extension has offered them. */
async function open(page: Page, request: APIRequestContext, models: Uint8Array[] = [tinyVrm1()]) {
  await request.post("/reset");
  const uploaded = [];
  for (const bytes of models) uploaded.push(await upload(request, bytes));
  await page.addInitScript(() => {
    // What three.js asks of WebGL, from the first context the page makes.
    const count: Record<string, number> = { context: 0, clear: 0, createBuffer: 0, deleteBuffer: 0, createTexture: 0, deleteTexture: 0 };
    (window as any).gl = count;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl2" && !(this as any).counted) {
        (this as any).counted = true;
        count.context++;
      }
      return (getContext as any).call(this, kind, ...rest);
    } as typeof getContext;
    const gl = WebGL2RenderingContext.prototype as any;
    for (const name of ["clear", "createBuffer", "deleteBuffer", "createTexture", "deleteTexture"]) {
      const own = gl[name];
      gl[name] = function (this: unknown, ...args: unknown[]) {
        count[name]++;
        return own.apply(this, args);
      };
    }
  });
  await page.goto("/");
  await page.waitForFunction((n) => (window as any).harness?.ready && (window as any).harness.entries().length === n, uploaded.length);
  return uploaded;
}

const mount = (page: Page, shown: { entry: string; size?: number; mode?: string; still?: boolean }) =>
  page.evaluate((s) => (window as any).harness.mount({ size: 380, mode: "idle", still: false, ...s }), shown);
const change = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => (window as any).harness.change(p), patch);
const counted = (page: Page) => page.evaluate(() => ({ ...(window as any).gl }) as Record<string, number>);
const avatar = (page: Page) => page.locator(".flair-avatar");
const drawn = (page: Page) => expect(avatar(page)).toHaveAttribute("data-shown", "drawn", { timeout: 30_000 });
/** The list again, as the page asks for it whenever it is shown. */
const refresh = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/** How many pixels of the frame the model covers: read in the frame after three.js has drawn it, before it is shown. */
const covered = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const gl = document.querySelector<HTMLCanvasElement>(".flair-avatar canvas")!;
          const copy = document.createElement("canvas");
          copy.width = gl.width;
          copy.height = gl.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(gl, 0, 0);
          const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
          let n = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
          resolve(n);
        }),
      ),
  );
const frames = async (page: Page, n: number) => {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) seen.push(await covered(page));
  return seen;
};
const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

test("each model is offered as an avatar of its own, by its name, and taken out when it is gone", async ({ page, request }) => {
  const [one, zero] = await open(page, request, [tinyVrm1(), tinyVrm0()]);
  expect(await page.evaluate(() => (window as any).harness.entries())).toEqual([
    { id: one.id, title: "Tiny", description: "3D model" },
    { id: zero.id, title: "Tiny Zero", description: "3D model" },
  ]);
  await request.delete(`${API}/models/${one.id}`);
  await request.patch(`${API}/models/${zero.id}`, { data: { name: "Zero" } });
  await refresh(page);
  await expect.poll(() => page.evaluate(() => (window as any).harness.entries())).toEqual([{ id: zero.id, title: "Zero", description: "3D model" }]);
});

test("the mouth opens with the reply played and stays shut otherwise", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id, mode: "idle" });
  await drawn(page);
  await expect(page.getByTestId("orb")).toHaveCount(0);
  const idle = await frames(page, 12);
  // The person heard loudly: the mouth stays shut.
  await change(page, { mode: "input", level: 0.8 });
  const heard = await frames(page, 12);
  // The reply played at 0.8: the mouth wide open, the tiny model's triangle half as tall again.
  await change(page, { mode: "output", level: 0.8 });
  await page.waitForTimeout(300);
  const speaking = await frames(page, 12);
  // Shut, but for a blink now and then: the tiny model's blink moves the same triangle.
  expect(median(heard)).toBe(median(idle));
  expect(median(speaking)).toBeGreaterThan(median(idle) * 1.3);
  await change(page, { mode: "idle", level: undefined });
  await page.waitForTimeout(600);
  expect(median(await frames(page, 12))).toBe(median(idle));
});

test("the canvas follows the box from 380 to 100 to 64 pixels without being made again, and frames the face below 160", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  const canvas = page.locator(".flair-avatar canvas");
  await canvas.evaluate((c) => ((c as any).first = true));
  const sized = async (size: number) => {
    await change(page, { size });
    // Larger than the box by 3/14 of it on each side, as the orb's.
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(Math.floor((size * 10) / 7));
    expect(await canvas.evaluate((c) => (c as any).first)).toBe(true);
    return page.locator(".flair-avatar-gl").getAttribute("data-framing");
  };
  expect(await sized(380)).toBe("bust");
  expect(await sized(100)).toBe("face");
  expect(await sized(64)).toBe("face");
  expect(await sized(380)).toBe("bust");
  expect(await counted(page)).toMatchObject({ context: 1 });
});

test("nothing is drawn while the box is out of view", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  await change(page, { hidden: true });
  await page.waitForTimeout(300);
  const before = (await counted(page)).clear;
  await page.waitForTimeout(1000);
  expect((await counted(page)).clear).toBe(before);
  await change(page, { hidden: false });
  await expect.poll(async () => (await counted(page)).clear).toBeGreaterThan(before);
});

test("with less motion asked for, it draws at most 20 frames a second", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  const before = (await counted(page)).clear;
  await page.waitForTimeout(2000);
  const drawnFrames = (await counted(page)).clear - before;
  expect(drawnFrames).toBeGreaterThan(5);
  expect(drawnFrames).toBeLessThanOrEqual(40);
});

test("a still avatar makes no drawing context: the orb until the model has a portrait, then the portrait", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id, still: true });
  await expect(page.getByTestId("orb")).toBeVisible();
  await request.put(`${API}/models/${model.id}/portrait`, { data: PNG, headers: { "content-type": "image/png" } });
  await refresh(page);
  await expect(page.locator(".flair-avatar-still")).toBeVisible();
  await expect(page.getByTestId("orb")).toHaveCount(0);
  expect((await counted(page)).context).toBe(0);
});

test("a model whose file cannot be fetched draws the orb", async ({ page, request }) => {
  const [model] = await open(page, request);
  await request.delete(`${API}/models/${model.id}`);
  await mount(page, { entry: model.id });
  await expect(avatar(page)).toHaveAttribute("data-shown", "failed");
  await expect(page.getByTestId("orb")).toBeVisible();
});

test("without WebGL 2 the orb is drawn", async ({ page, request }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === "webgl2" ? null : (getContext as any).call(this, kind, ...rest);
    } as typeof getContext;
  });
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await expect(avatar(page)).toHaveAttribute("data-shown", "unsupported");
  await expect(page.getByTestId("orb")).toBeVisible();
  expect(await page.evaluate(() => (window as any).harness.failures)).toEqual([]);
});

test("a lost drawing context shows the orb until it is given back, and the model is drawn again then", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  // Kept from before: a lost context gives no extension.
  await page.evaluate(() => ((window as any).losing = document.querySelector<HTMLCanvasElement>(".flair-avatar canvas")!.getContext("webgl2")!.getExtension("WEBGL_lose_context")));
  const lose = (how: "loseContext" | "restoreContext") => page.evaluate((h) => (window as any).losing[h](), how);
  await lose("loseContext");
  await expect(avatar(page)).toHaveAttribute("data-shown", "lost");
  await expect(page.getByTestId("orb")).toBeVisible();
  await lose("restoreContext");
  await drawn(page);
  await expect(page.getByTestId("orb")).toHaveCount(0);
  expect(median(await frames(page, 5))).toBeGreaterThan(0);
});

test("unmounted, it deletes what it uploaded and gives its context back, also after a context was given back", async ({ page, request }) => {
  const [model] = await open(page, request);
  const context = () =>
    page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>(".flair-avatar canvas")!.getContext("webgl2")!;
      Object.assign(window, { context: gl, losing: gl.getExtension("WEBGL_lose_context") });
    });
  await mount(page, { entry: model.id });
  await drawn(page);
  await context();
  await page.evaluate(() => (window as any).harness.unmount());
  const after = await counted(page);
  expect(after.createBuffer).toBeGreaterThan(0);
  expect(after.deleteBuffer).toBe(after.createBuffer);
  expect(await page.evaluate(() => (window as any).context.isContextLost())).toBe(true);

  // Once more, with a context lost and given back on the way: what was uploaded again is deleted again.
  await mount(page, { entry: model.id });
  await drawn(page);
  await context();
  await page.evaluate(() => (window as any).losing.loseContext());
  await expect(avatar(page)).toHaveAttribute("data-shown", "lost");
  const lost = await counted(page);
  await page.evaluate(() => (window as any).losing.restoreContext());
  await drawn(page);
  await page.evaluate(() => (window as any).harness.unmount());
  const end = await counted(page);
  expect(end.createBuffer - lost.createBuffer).toBeGreaterThan(0);
  // Those from before the loss as well, which three.js still holds.
  expect(end.deleteBuffer - lost.deleteBuffer).toBeGreaterThanOrEqual(end.createBuffer - lost.createBuffer);
  expect(await page.evaluate(() => (window as any).context.isContextLost())).toBe(true);
});

test("a VRM 0.x model is drawn as a VRM 1.0 one is", async ({ page, request }) => {
  const [model] = await open(page, request, [tinyVrm0()]);
  await mount(page, { entry: model.id, mode: "output" });
  await drawn(page);
  expect(Math.max(...(await frames(page, 5)))).toBeGreaterThan(0);
});

test.describe("with real models", () => {
  test("pixiv's sample model is drawn, and gives back each texture it uploaded", async ({ page, request }) => {
    const file = sample("twist");
    test.skip(!file, "the sample model could not be fetched");
    const warnings: string[] = [];
    page.on("console", (m) => (m.type() === "warning" || m.type() === "error") && warnings.push(m.text()));
    const [tiny, model] = await open(page, request, [tinyVrm1(), readFileSync(file!)]);
    // What a renderer keeps for itself until its context goes (the textures it binds when none is), whatever it drew:
    // at most what is left after the tiny model, whose only texture is its morph target's.
    await mount(page, { entry: tiny.id });
    await drawn(page);
    await page.evaluate(() => (window as any).harness.unmount());
    const own = await counted(page);
    const kept = own.createTexture - own.deleteTexture;
    await mount(page, { entry: model.id, mode: "output" });
    await drawn(page);
    for (const [mode, size] of [["idle", 380], ["input", 380], ["output", 380], ["thinking", 380], ["muted", 380], ["idle", 64]] as const) {
      await change(page, { mode, size });
      await page.waitForTimeout(mode === "thinking" ? 2500 : 900);
      if (process.env.SHOTS) await page.locator('[data-testid="box"]').screenshot({ path: `${process.env.SHOTS}/harness-${mode}-${size}.png` });
    }
    await page.evaluate(() => (window as any).harness.unmount());
    const after = await counted(page);
    expect(after.createTexture - own.createTexture).toBeGreaterThan(20);
    expect(after.createTexture - own.createTexture - (after.deleteTexture - own.deleteTexture)).toBeLessThanOrEqual(kept);
    expect(warnings.filter((w) => /VRM/.test(w))).toEqual([]);
  });

  test("Seed-san, whose eyes look by expressions, is drawn", async ({ page, request }) => {
    const file = sample("seed");
    test.skip(!file, "the sample model could not be fetched");
    const warnings: string[] = [];
    page.on("console", (m) => (m.type() === "warning" || m.type() === "error") && warnings.push(m.text()));
    const bytes = readFileSync(file!);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    expect(json.extensions.VRMC_vrm.lookAt.type).toBe("expression");
    const [model] = await open(page, request, [bytes]);
    await mount(page, { entry: model.id, mode: "thinking" });
    await drawn(page);
    expect(Math.max(...(await frames(page, 3)))).toBeGreaterThan(0);
    expect(warnings.filter((w) => /VRM/.test(w))).toEqual([]);
  });
});
