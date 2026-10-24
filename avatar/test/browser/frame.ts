import type { Page } from "@playwright/test";

/** A part of the frame, as shares of its width and height from its top left: [left, top, right, bottom]. */
type Box = [number, number, number, number];
/** A frame a live avatar drew: its motion's time then, in seconds from its first frame, and the pixels covered in each part asked for. */
export type Seen = { t: number; covered: number[] };

/**
 * The frames a live avatar draws, watched in the page from before it loads: the time of its motion in each, and the
 * pixels it covers in parts of the frame.
 *
 * The motion moves on in each frame by the time since the one before, but by 1/15 s at most (stage.ts), so how far it
 * has got is not how long the test has waited: a software renderer that draws two frames a second plays the 2.5 s
 * before the hand goes to the chin in 19 s, one that draws ten in under 4. So the tests wait for the motion's time.
 * It is kept here as the stage keeps it: a frame starts with the clear of the avatar's canvas, at the frame's time
 * (the one three.js is given), the time since the frame before it, or since the canvas's context was made, at most
 * 1/15 s; and as the page is shown again (`visibilitychange`), three.js' Timer counts that frame from then.
 *
 * A part asked for (`track`) is read in every frame, once it is drawn: three.js draws a frame in one call, the clear
 * first, and what it drew can be read until the task it was drawn in ends.
 */
export const watchFrames = (page: Page) =>
  page.addInitScript(() => {
    // Once, however often a test opens the page.
    if ((window as any).frameWatch) return;
    const covered = (canvas: HTMLCanvasElement, [left, top, right, bottom]: Box) => {
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      const [x, y] = [Math.round(left * canvas.width), Math.round(top * canvas.height)];
      const pixels = ctx.getImageData(x, y, Math.round(right * canvas.width) - x, Math.round(bottom * canvas.height) - y).data;
      let n = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
      return n;
    };
    const watch = { covered, canvas: undefined as HTMLCanvasElement | undefined, t: 0, boxes: [] as Box[], seen: [] as Seen[] };
    (window as any).frameWatch = watch;
    const since = new WeakMap<HTMLCanvasElement, number>();
    let shown = -Infinity;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) shown = performance.now();
    });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl2" && !since.has(this)) since.set(this, performance.now());
      return (getContext as any).call(this, kind, ...rest);
    } as typeof getContext;
    const clear = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function (this: WebGL2RenderingContext, mask: number) {
      const canvas = this.canvas;
      if (canvas instanceof HTMLCanvasElement && canvas.closest(".flair-avatar-gl")) {
        if (canvas !== watch.canvas) Object.assign(watch, { canvas, t: 0, seen: [] });
        const now = document.timeline.currentTime as number;
        watch.t += Math.min(now - Math.max(since.get(canvas) ?? now, shown), 1000 / 15) / 1000;
        since.set(canvas, now);
        // Once the frame is drawn, in the same task, while what it drew is there to read.
        const { t, boxes } = watch;
        if (boxes.length) queueMicrotask(() => watch.seen.push({ t, covered: boxes.map((box) => covered(canvas, box)) }));
      }
      return clear.call(this, mask);
    };
  });

/**
 * How many pixels the model covers in a part of the frame, in the frame drawn last. Where a hand is raised beside the
 * head, say.
 */
export const within = (page: Page, box: Box, canvas = ".flair-avatar-gl canvas") =>
  page.evaluate(
    ({ box, canvas }) =>
      new Promise<number>((resolve) => requestAnimationFrame(() => resolve((window as any).frameWatch.covered(document.querySelector(canvas)!, box)))),
    { box, canvas },
  );
/** Beside the head on the viewer's left, where the model's right hand waves, and on the viewer's right. */
export const VIEWER_LEFT: Box = [0, 0, 0.36, 0.5];
export const VIEWER_RIGHT: Box = [0.64, 0, 1, 0.5];

/** How far the motion of the avatar drawn has got: seconds of its time from its first frame. */
export const motionTime = (page: Page) => page.evaluate(() => (window as any).frameWatch.t as number);

/**
 * Until the motion of the avatar drawn has got to `t` seconds of its time, however long its frames take: as long as
 * the test may take.
 */
export const until = (page: Page, t: number) => page.waitForFunction((t) => (window as any).frameWatch.t >= t, t, { timeout: 0, polling: 100 });
/** Until the avatar drawn has played `seconds` more of its motion. */
export const played = async (page: Page, seconds: number) => until(page, (await motionTime(page)) + seconds);

/**
 * From now, the pixels covered in each of `boxes` in every frame drawn, read by `seen`: the frames of an avatar drawn
 * after this from its first, of the one drawn now from its next. No boxes stops it.
 */
export const track = (page: Page, boxes: Box[]) =>
  page.evaluate((boxes) => Object.assign((window as any).frameWatch, { boxes, seen: [] }), boxes);
/** The frames read since `track`, each with the motion's time it was drawn at. */
export const seen = (page: Page) => page.evaluate(() => (window as any).frameWatch.seen as Seen[]);
