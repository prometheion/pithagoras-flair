import type { Page } from "@playwright/test";

/**
 * How many pixels the model covers in a part of the frame, given as shares of its width and height from its top left:
 * [left, top, right, bottom]. Where a hand is raised beside the head, say.
 */
export const within = (page: Page, [left, top, right, bottom]: [number, number, number, number], canvas = ".flair-avatar-gl canvas") =>
  page.evaluate(
    ({ box, canvas }) =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const gl = document.querySelector<HTMLCanvasElement>(canvas)!;
          const copy = document.createElement("canvas");
          copy.width = gl.width;
          copy.height = gl.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(gl, 0, 0);
          const [x, y] = [Math.round(box[0] * gl.width), Math.round(box[1] * gl.height)];
          const pixels = ctx.getImageData(x, y, Math.round(box[2] * gl.width) - x, Math.round(box[3] * gl.height) - y).data;
          let n = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
          resolve(n);
        }),
      ),
    { box: [left, top, right, bottom], canvas },
  );
/** Beside the head on the viewer's left, where the model's right hand waves, and on the viewer's right. */
export const VIEWER_LEFT: [number, number, number, number] = [0, 0, 0.36, 0.5];
export const VIEWER_RIGHT: [number, number, number, number] = [0.64, 0, 1, 0.5];
