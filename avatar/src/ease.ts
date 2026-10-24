/**
 * How the motion moves from one value to another over time, the same whatever the frame rate: pure, for motion.ts,
 * mouth.ts and gestures.ts.
 */

/** `a` moved towards `b` at `lambda` per second for `dt` seconds: the same path whatever the steps. */
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/**
 * A movement that comes and goes, `age` seconds after it began: 0 before then, up to 1 at `rise` seconds and back
 * smoothly towards 0 after, a third of the way back at 3 × `rise` and nearly all of it by 8 ×. How a nod or a flick of
 * the hand goes, with no end to wait for. One that never began (`age` Infinity, from a start at -Infinity) is 0.
 */
export const pulse = (age: number, rise: number) => (age < 0 || age === Infinity ? 0 : (age / rise) * Math.exp(1 - age / rise));

/** 0 to 1 as `x` goes from 0 to 1, starting and ending slowly; 0 before and 1 after. */
export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
