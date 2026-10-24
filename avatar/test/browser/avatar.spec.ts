import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { tinyVrm0, tinyVrm1 } from "../tiny-vrm.ts";
import { tinyVrma } from "../tiny-vrma.ts";
import { sample } from "./fetch-models.ts";
import { VIEWER_LEFT, VIEWER_RIGHT, within } from "./frame.ts";

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
/** The orb, drawn and not faded out with the model's canvas: Playwright counts an element at opacity 0 as visible. */
const orbShown = async (page: Page) => {
  await expect(page.getByTestId("orb")).toBeVisible();
  await expect(page.getByTestId("orb")).toHaveCSS("opacity", "1");
};
/** The list again, as the page asks for it whenever it is shown. */
const refresh = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/**
 * How many pixels of the frame the model covers, and how wide and tall what it covers is: read in the frame after
 * three.js has drawn it, before it is shown.
 */
type Covered = { pixels: number; width: number; height: number };
const covered = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Covered>((resolve) =>
        requestAnimationFrame(() => {
          const gl = document.querySelector<HTMLCanvasElement>(".flair-avatar-gl canvas")!;
          const copy = document.createElement("canvas");
          copy.width = gl.width;
          copy.height = gl.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(gl, 0, 0);
          const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
          let n = 0;
          const [x, y] = [[Infinity, -Infinity], [Infinity, -Infinity]];
          for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] === 0) continue;
            n++;
            const at = (i - 3) / 4;
            const [px, py] = [at % copy.width, Math.floor(at / copy.width)];
            x[0] = Math.min(x[0], px);
            x[1] = Math.max(x[1], px);
            y[0] = Math.min(y[0], py);
            y[1] = Math.max(y[1], py);
          }
          resolve({ pixels: n, width: n && x[1] - x[0] + 1, height: n && y[1] - y[0] + 1 });
        }),
      ),
  );
const frames = async (page: Page, n: number) => {
  const seen: Covered[] = [];
  for (let i = 0; i < n; i++) seen.push(await covered(page));
  return seen;
};
const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
/** The mean of each colour channel, 0 to 255, where the model covers the frame whole. */
const tone = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ r: number; g: number; b: number }>((resolve) =>
        requestAnimationFrame(() => {
          const gl = document.querySelector<HTMLCanvasElement>(".flair-avatar-gl canvas")!;
          const copy = document.createElement("canvas");
          copy.width = gl.width;
          copy.height = gl.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(gl, 0, 0);
          const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
          const sum = [0, 0, 0];
          let n = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 250) continue;
            n++;
            for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
          }
          resolve({ r: sum[0] / n, g: sum[1] / n, b: sum[2] / n });
        }),
      ),
  );
/** How much of what the model covers in the frame is coloured (its channels more than 40 apart), not white or grey. */
const coloured = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const gl = document.querySelector<HTMLCanvasElement>(".flair-avatar-gl canvas")!;
          const copy = document.createElement("canvas");
          copy.width = gl.width;
          copy.height = gl.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(gl, 0, 0);
          const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
          let covered = 0;
          let colour = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 250) continue;
            covered++;
            const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
            if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colour++;
          }
          resolve(colour / covered);
        }),
      ),
  );

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
  // How tall the tiny model's triangle is for its width, which the mouth and the blink make taller, and leaning in
  // (drawn nearer) does not change.
  const tall = async () => median((await frames(page, 12)).map((c) => c.height / c.width));
  const idle = await tall();
  // The person heard loudly: the mouth stays shut.
  await change(page, { mode: "input", level: 0.8 });
  const heard = await tall();
  // The reply played at 0.8: the mouth wide open, the triangle half as tall again.
  await change(page, { mode: "output", level: 0.8 });
  await page.waitForTimeout(300);
  const speaking = await tall();
  // Shut, but for a blink now and then: the tiny model's blink moves the same triangle. Within a pixel's rounding.
  expect(Math.abs(heard - idle)).toBeLessThan(0.04);
  expect(speaking).toBeGreaterThan(idle * 1.3);
  await change(page, { mode: "idle", level: undefined });
  await page.waitForTimeout(600);
  expect(Math.abs((await tall()) - idle)).toBeLessThan(0.04);
});

test("while the person is heard it leans in, drawn nearer: the face a twelfth larger, and back after", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id, mode: "idle" });
  await drawn(page);
  // The tiny model's triangle is not bound to a bone: how wide it is shows what the camera does alone.
  const wide = async () => median((await frames(page, 5)).map((c) => c.width));
  const idle = await wide();
  await change(page, { mode: "input", level: 0.5 });
  await page.waitForTimeout(1500);
  // 8% nearer: 1 / 0.92 as wide.
  expect((await wide()) / idle).toBeGreaterThan(1.06);
  await change(page, { mode: "idle", level: undefined });
  await page.waitForTimeout(1500);
  expect(Math.abs((await wide()) / idle - 1)).toBeLessThan(0.02);
});

test("the canvas follows the box from 380 to 100 to 64 pixels without being made again, and frames the face below 160", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  const canvas = page.locator(".flair-avatar-gl canvas");
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

test("a still avatar makes no drawing context: the orb until the model has a portrait, then the portrait, and a new one when it is made again", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id, still: true });
  await orbShown(page);
  await request.put(`${API}/models/${model.id}/portrait?stamp=1`, { data: PNG, headers: { "content-type": "image/png" } });
  await refresh(page);
  const still = page.locator(".flair-avatar-still");
  await expect(still).toBeVisible();
  await expect(page.getByTestId("orb")).toHaveCount(0);
  const first = await still.getAttribute("src");
  await request.put(`${API}/models/${model.id}/portrait?stamp=1`, { data: PNG, headers: { "content-type": "image/png" } });
  await refresh(page);
  await expect(still).not.toHaveAttribute("src", first!);
  expect((await counted(page)).context).toBe(0);
});

test("what is set on a model reaches its avatar already drawn, in its next frames, without making it again", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  const set = async (settings: Record<string, unknown>) => {
    expect((await request.put(`${API}/models/${model.id}/settings`, { data: { settings } })).status()).toBe(200);
    // The list again, as the page reads it when it is shown; the Settings page reads it after each change.
    await refresh(page);
  };
  const pixels = async () => median((await frames(page, 3)).map((c) => c.pixels));
  const before = await pixels();
  // The camera eases to it as to a new framing. 1.5 times as near is 2.25 times the area, less what the box cuts.
  await set({ zoom: 1.5 });
  await expect.poll(async () => (await pixels()) / before, { timeout: 2000 }).toBeGreaterThan(1.6);
  const usual = await tone(page);
  const light = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  await set({ zoom: 1.5, brightness: 1.5 });
  await expect.poll(async () => light(await tone(page)), { timeout: 2000 }).toBeGreaterThan(light(usual) + 5);
  const bright = await tone(page);
  await set({ zoom: 1.5, brightness: 1.5, warmth: 1 });
  await expect.poll(async () => { const warm = await tone(page); return warm.r - warm.b; }, { timeout: 2000 }).toBeGreaterThan(bright.r - bright.b + 5);
  // The same stage all along, and the same entry: only a rename registers it again.
  expect((await counted(page)).context).toBe(1);
});

test("what is set on the Settings page in another tab reaches the avatar drawn here at once, this page never hidden", async ({ page, context, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  await page.evaluate(() => {
    (window as any).shownAgain = 0;
    document.addEventListener("visibilitychange", () => (window as any).shownAgain++);
  });
  const pixels = async () => median((await frames(page, 3)).map((c) => c.pixels));
  const before = await pixels();
  const settings = await context.newPage();
  await settings.goto("/");
  await settings.waitForFunction(() => (window as any).harness?.ready);
  await settings.evaluate(() => (window as any).harness.settings());
  const zoom = settings.getByRole("slider", { name: "Zoom" });
  await zoom.focus();
  for (let i = 0; i < 10; i++) await zoom.press("ArrowRight");
  await expect.poll(async () => (await (await request.get(`${API}/models`)).json()).models[0].settings).toEqual({ zoom: 1.5 });
  // 1.5 times as near, as when it is set on this page.
  await expect.poll(async () => (await pixels()) / before, { timeout: 3000 }).toBeGreaterThan(1.6);
  expect(await page.evaluate(() => (window as any).shownAgain)).toBe(0);
  expect((await counted(page)).context).toBe(1);
});

test("an entry is registered again for a rename, and not for new settings or a new portrait", async ({ page, request }) => {
  const [model] = await open(page, request);
  await page.evaluate(() => ((window as any).before = (window as any).harness.registered()));
  const same = () => page.evaluate(() => (window as any).harness.registered().every((e: unknown, i: number) => e === (window as any).before[i]));
  await request.put(`${API}/models/${model.id}/settings`, { data: { settings: { zoom: 1.2 } } });
  await request.put(`${API}/models/${model.id}/portrait?stamp=1`, { data: PNG, headers: { "content-type": "image/png" } });
  await refresh(page);
  // The list read, and what it changed drawn.
  await page.waitForTimeout(300);
  expect(await same()).toBe(true);
  await request.patch(`${API}/models/${model.id}`, { data: { name: "Renamed" } });
  await refresh(page);
  await expect.poll(() => page.evaluate(() => (window as any).harness.entries())).toEqual([{ id: model.id, title: "Renamed", description: "3D model" }]);
  expect(await same()).toBe(false);
});

test("a model whose file cannot be fetched draws the orb", async ({ page, request }) => {
  const [model] = await open(page, request);
  await request.delete(`${API}/models/${model.id}`);
  await mount(page, { entry: model.id });
  await expect(avatar(page)).toHaveAttribute("data-shown", "failed");
  await orbShown(page);
});

test("the orb is drawn while the model loads", async ({ page, request }) => {
  const [model] = await open(page, request);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route((url) => url.pathname.endsWith(`/models/${model.id}/file`), async (route) => {
    await held;
    await route.continue();
  });
  await mount(page, { entry: model.id });
  await expect(avatar(page)).toHaveAttribute("data-shown", "loading");
  await orbShown(page);
  release();
  await drawn(page);
  await expect(page.getByTestId("orb")).toHaveCount(0);
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
  await orbShown(page);
  expect(await page.evaluate(() => (window as any).harness.failures)).toEqual([]);
});

test("a lost drawing context shows the orb until it is given back, and the model is drawn again then", async ({ page, request }) => {
  const [model] = await open(page, request);
  await mount(page, { entry: model.id });
  await drawn(page);
  // Kept from before: a lost context gives no extension.
  await page.evaluate(() => ((window as any).losing = document.querySelector<HTMLCanvasElement>(".flair-avatar-gl canvas")!.getContext("webgl2")!.getExtension("WEBGL_lose_context")));
  const lose = (how: "loseContext" | "restoreContext") => page.evaluate((h) => (window as any).losing[h](), how);
  await lose("loseContext");
  await expect(avatar(page)).toHaveAttribute("data-shown", "lost");
  await orbShown(page);
  await lose("restoreContext");
  await drawn(page);
  await expect(page.getByTestId("orb")).toHaveCount(0);
  expect(median((await frames(page, 5)).map((c) => c.pixels))).toBeGreaterThan(0);
});

test("unmounted, it deletes what it uploaded and gives its context back, also after a context was given back", async ({ page, request }) => {
  const [model] = await open(page, request);
  const context = () =>
    page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>(".flair-avatar-gl canvas")!.getContext("webgl2")!;
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
  expect(Math.max(...(await frames(page, 5)).map((c) => c.pixels))).toBeGreaterThan(0);
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

  test("pixiv's sample model is drawn with its textures under the portal's Content-Security-Policy", async ({ page, request }) => {
    const file = sample("twist");
    test.skip(!file, "the sample model could not be fetched");
    const refused: string[] = [];
    page.on("console", (m) => /Content Security Policy|Couldn't load texture/.test(m.text()) && refused.push(m.text()));
    const [model] = await open(page, request, [readFileSync(file!)]);
    await mount(page, { entry: model.id });
    await drawn(page);
    // Its hair, eyes and skin. Drawn without its textures, it is white and grey: a fifth of a percent of it coloured.
    expect(await coloured(page)).toBeGreaterThan(0.1);
    expect(refused).toEqual([]);
  });

  test("pixiv's sample model waves its right hand beside its head as voice mode starts, and lowers it", async ({ page, request }) => {
    const file = sample("twist");
    test.skip(!file, "the sample model could not be fetched");
    const [model] = await open(page, request, [readFileSync(file!)]);
    await mount(page, { entry: model.id, mode: "idle" });
    await drawn(page);
    const [before, right] = [await within(page, VIEWER_LEFT), await within(page, VIEWER_RIGHT)];
    // The software renderer draws a few frames a second, each at most 1/15 s of the motion's time: slowly.
    await expect.poll(() => within(page, VIEWER_LEFT), { timeout: 30_000, intervals: [200] }).toBeGreaterThan(before + 2000);
    await expect.poll(() => within(page, VIEWER_LEFT), { timeout: 30_000, intervals: [200] }).toBeLessThan(before + 300);
    // Its left hand stays down.
    expect(await within(page, VIEWER_RIGHT)).toBeLessThan(right + 300);
  });

  test("a clip uploaded is fetched once while the model is drawn and played in place of its gesture; removed, it is dropped at once", async ({ page, request }) => {
    const file = sample("twist");
    test.skip(!file, "the sample model could not be fetched");
    const [model] = await open(page, request, [readFileSync(file!)]);
    const fetched: string[] = [];
    page.on("request", (r) => r.url().includes("/clips/") && fetched.push(new URL(r.url()).pathname + new URL(r.url()).search));
    // Clips that turn the LEFT arm, so they are told from the model's own gestures, made with its right: the wave's
    // raises it from up to past level, the thinking one holds it up.
    const leftArm = (json: Record<string, any>) => {
      json.extensions.VRMC_vrm_animation.humanoid.humanBones = { hips: { node: 0 }, spine: { node: 1 }, leftUpperArm: { node: 2 } };
      json.nodes[2].translation = [0.15, 0.3, 0];
    };
    const put = async (gesture: string, bytes: Uint8Array) => {
      const up = await request.put(`${API}/models/${model.id}/clips/${gesture}?name=left.vrma`, { data: Buffer.from(bytes), headers: { "content-type": "application/octet-stream" } });
      expect(up.status()).toBe(200);
      return (await up.json()).model.clips[gesture].sha256 as string;
    };
    // The person speaks first: no wave as it starts.
    await mount(page, { entry: model.id, mode: "input" });
    await drawn(page);
    const [leftBefore, rightBefore] = [await within(page, VIEWER_LEFT), await within(page, VIEWER_RIGHT)];
    const wave = await put("greeting", tinyVrma(leftArm));
    await refresh(page);
    await expect.poll(() => fetched).toEqual([`${API}/models/${model.id}/clips/greeting?v=${wave}`]);
    // Mounted again: a new stage, which has not heard the person, and waves with the clip as it starts.
    await mount(page, { entry: model.id, mode: "idle" });
    await drawn(page);
    await expect.poll(() => within(page, VIEWER_RIGHT), { timeout: 30_000, intervals: [200] }).toBeGreaterThan(rightBefore + 1000);
    expect(await within(page, VIEWER_LEFT)).toBeLessThan(leftBefore + 300);
    // The wave over.
    await expect.poll(() => within(page, VIEWER_RIGHT), { timeout: 30_000, intervals: [200] }).toBeLessThan(rightBefore + 300);

    // On a long think, the thinking clip; removed while it plays, the model's own hand to the chin at once.
    const think = await put("thinking", tinyVrma(leftArm, [1.2, 1.2]));
    await refresh(page);
    await expect.poll(() => fetched).toContain(`${API}/models/${model.id}/clips/thinking?v=${think}`);
    await change(page, { mode: "thinking" });
    await expect.poll(() => within(page, VIEWER_RIGHT), { timeout: 30_000, intervals: [200] }).toBeGreaterThan(rightBefore + 1000);
    const asked = fetched.length;
    await request.delete(`${API}/models/${model.id}/clips/thinking`);
    await refresh(page);
    await expect.poll(() => within(page, VIEWER_RIGHT), { timeout: 30_000, intervals: [200] }).toBeLessThan(rightBefore + 300);
    expect(fetched.length).toBe(asked);
  });

  test("three-vrm-animation's own example clip is read and played with no warning", async ({ page, request }) => {
    const [file, clip] = [sample("twist"), sample("clip")];
    test.skip(!file || !clip, "the sample model or clip could not be fetched");
    const warnings: string[] = [];
    page.on("console", (m) => (m.type() === "warning" || m.type() === "error") && warnings.push(m.text()));
    const [model] = await open(page, request, [readFileSync(file!)]);
    const up = await request.put(`${API}/models/${model.id}/clips/thinking?name=test.vrma`, { data: readFileSync(clip!), headers: { "content-type": "application/octet-stream" } });
    expect(up.status()).toBe(200);
    await refresh(page);
    const fetchedClip = page.waitForResponse((r) => r.url().includes("/clips/thinking"));
    await mount(page, { entry: model.id, mode: "thinking" });
    await drawn(page);
    expect((await fetchedClip).status()).toBe(200);
    await page.waitForTimeout(4000);
    expect(Math.max(...(await frames(page, 3)).map((c) => c.pixels))).toBeGreaterThan(0);
    expect(warnings.filter((w) => /VRM|clip/.test(w))).toEqual([]);
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
    expect(Math.max(...(await frames(page, 3)).map((c) => c.pixels))).toBeGreaterThan(0);
    expect(warnings.filter((w) => /VRM/.test(w))).toEqual([]);
  });
});
