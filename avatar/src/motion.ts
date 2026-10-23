import type { AvatarMode } from "@pithagoras/extension-api";

/**
 * How the avatar moves, from what voice mode is doing and how loud the reply is: a pure step, called once a frame
 * with the time since the last, that says how open the mouth is, how far the eyes are shut, the angle of each bone it
 * moves and where the eyes look. No three.js in here, so it is tested on its own.
 *
 * Every change is made over time, not per frame (`damp`), so the avatar moves the same at 15, 30 or 60 frames a
 * second. Angles are radians on three-vrm's normalized bones, which are the same for VRM 0.x and 1.0 models: x tips a
 * bone forward, towards the camera, y turns it to the model's left (the viewer's right), z rolls it.
 */

/** The bones it moves. Only hips, spine, head and the limbs are bones every VRM model has: the stage skips one a model lacks. */
export type Bone = "spine" | "chest" | "neck" | "head" | "leftUpperArm" | "rightUpperArm" | "leftLowerArm" | "rightLowerArm";

export interface MotionInput {
  mode: AvatarMode;
  /** How loud the reply played now is, 0 to 1. */
  output: number;
  /** Seconds since the last step. */
  dt: number;
  /** The system asks for less motion. */
  reduced: boolean;
}

export interface Pose {
  /** The VRM expressions it sets, 0 to 1: the mouth open (`aa`) and rounded (`oh`), and the eyes shut (`blink`). */
  expressions: { aa: number; oh: number; blink: number };
  bones: Record<Bone, [number, number, number]>;
  /** Where the eyes look, from the camera, in metres to the right and up. */
  gaze: [number, number];
}

/** `a` moved towards `b` at `lambda` per second for `dt` seconds: the same path whatever the steps. */
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/**
 * How long the agent has to be thinking before the head takes the thinking pose. Between two phrases of one reply
 * voice mode says thinking for a moment, and the next phrase usually starts within this, so the head does not dip
 * between sentences.
 */
export const THINK_AFTER = 0.6;
/** How long a blink is: half of it closing, half opening. */
export const BLINK = 0.15;

export function createMotion(random: () => number = Math.random) {
  // Seconds since it started, and what is eased towards its target from frame to frame.
  let t = 0;
  let mouth = 0;
  let voice = 0;
  let lean = 0;
  let think = 0;
  // How long the mode has been thinking, 0 for any other.
  let thinking = 0;
  // A blink starts every 2 to 6 seconds, and one in ten has a second 0.25 s after it.
  let nextBlink = 2 + 4 * random();
  let blinkAt = -Infinity;
  let second = Infinity;
  // The eyes move to a new point near the camera every 0.8 to 2.5 seconds, as eyes make small jumps.
  let nextSaccade = 0.8 + 1.7 * random();
  let saccade: [number, number] = [0, 0];

  return {
    step({ mode, output, dt, reduced }: MotionInput): Pose {
      t += dt;

      if (t >= nextBlink) {
        blinkAt = nextBlink;
        second = random() < 0.1 ? blinkAt + 0.25 : Infinity;
        nextBlink = blinkAt + 2 + 4 * random();
      }
      if (t >= second) {
        blinkAt = second;
        second = Infinity;
      }
      if (t >= nextSaccade) {
        const angle = 2 * Math.PI * random();
        const r = 0.02 * Math.sqrt(random());
        saccade = [r * Math.cos(angle), r * Math.sin(angle)];
        nextSaccade += 0.8 + 1.7 * random();
      }

      const was = thinking;
      thinking = mode === "thinking" ? thinking + dt : 0;
      // The thinking pose begins with a blink, unless one is under way.
      if (was < THINK_AFTER && thinking >= THINK_AFTER && t - blinkAt >= BLINK) blinkAt = t - (thinking - THINK_AFTER);
      think = damp(think, thinking >= THINK_AFTER ? 1 : 0, 3, dt);
      lean = damp(lean, mode === "input" ? 1 : 0, 4, dt);

      // Opens fast with the voice and closes more slowly, as a mouth does between syllables.
      const open = mode === "output" ? Math.min(1, 1.6 * output) : 0;
      mouth = damp(mouth, open, open > mouth ? 40 : 13, dt);
      voice = damp(voice, mode === "output" ? output : 0, 3, dt);

      const since = (t - blinkAt) / BLINK;
      const blink = since >= 0 && since < 1 ? (since < 0.5 ? 2 * since : 2 - 2 * since) : 0;

      // Reduced motion: no breathing, sway, saccades or nodding with the voice; leaning and the thinking pose at half.
      const breath = reduced ? 0 : Math.sin(1.6 * t);
      const swayX = reduced ? 0 : 0.04 * Math.sin(0.7 * t);
      const swayY = reduced ? 0 : 0.05 * Math.sin(0.43 * t);
      const nod = reduced ? 0 : 0.03 * voice;
      const look = reduced ? [0, 0] : saccade;
      const half = reduced ? 0.5 : 1;
      const leaning = lean * half;
      const pose = think * half;

      return {
        expressions: { aa: mouth, oh: 0.25 * mouth, blink },
        bones: {
          spine: [0.02 * breath + 0.08 * leaning, 0, 0],
          chest: [0.015 * breath, 0, 0],
          neck: [0.06 * leaning, 0, 0],
          head: [swayX + nod - 0.05 * pose, swayY + 0.12 * pose, 0.12 * pose],
          // A VRM model's rest pose is a T-pose: the arms down, and breathing with the chest.
          leftUpperArm: [0, 0, -1.2 + 0.02 * breath],
          rightUpperArm: [0, 0, 1.2 - 0.02 * breath],
          leftLowerArm: [0, 0, -0.15],
          rightLowerArm: [0, 0, 0.15],
        },
        gaze: [look[0] + 0.35 * pose, look[1] + 0.3 * pose],
      };
    },
  };
}
