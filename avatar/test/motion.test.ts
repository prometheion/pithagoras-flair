import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarMode } from "@pithagoras/extension-api";
import { BLINK, createMotion, THINK_AFTER, type Pose } from "../src/motion.ts";

/** How the avatar moves for each mode and level, step by step, without three.js. */

/** The same numbers every run: a small linear congruential generator. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Runs `motion` for `seconds` at `fps` in `mode`, the reply at `output`, and gives every pose with its time. */
function run(motion: ReturnType<typeof createMotion>, seconds: number, { fps = 60, mode = "idle" as AvatarMode, output = 0, reduced = false } = {}) {
  const poses: { t: number; pose: Pose }[] = [];
  const dt = 1 / fps;
  for (let i = 1; i <= Math.round(seconds * fps); i++) poses.push({ t: i * dt, pose: motion.step({ mode, output, dt, reduced }) });
  return poses;
}

/** When each blink starts: the first step its eyes begin to shut. */
const blinkStarts = (poses: { t: number; pose: Pose }[]) =>
  poses.filter((p, i) => p.pose.expressions.blink > 0 && (i === 0 || poses[i - 1].pose.expressions.blink === 0)).map((p) => p.t);

test("it blinks every 2 to 6 seconds, each blink 0.15 s, and some are doubled", () => {
  const poses = run(createMotion(seeded(7)), 600, { fps: 200 });
  const starts = blinkStarts(poses);
  assert.ok(starts.length > 100, `${starts.length} blinks in ten minutes`);
  const gaps = starts.slice(1).map((s, i) => s - starts[i]);
  const doubled = gaps.filter((g) => g < 1);
  for (const g of doubled) assert.ok(Math.abs(g - 0.25) < 0.011, `a second blink 0.25 s after the first, not ${g}`);
  for (const g of gaps.filter((g) => g >= 1)) assert.ok(g > 2 - 0.25 - 0.011 && g < 6 + 0.011, `a gap of ${g}`);
  assert.ok(doubled.length > 2 && doubled.length < starts.length / 4, `${doubled.length} doubled of ${starts.length}`);
  // Shut at the middle, open again by its end.
  const first = poses.findIndex((p) => p.t >= starts[0]);
  const shut = Math.max(...poses.slice(first, first + 40).map((p) => p.pose.expressions.blink));
  assert.ok(shut > 0.95, `shut to ${shut}`);
  assert.equal(poses.find((p) => p.t >= starts[0] + BLINK + 0.006)!.pose.expressions.blink, 0);
});

test("the mouth opens with the reply within 60 ms, shuts within 200 ms, and stays shut unless the reply is played", () => {
  const motion = createMotion(seeded(1));
  const open = run(motion, 0.06, { fps: 200, mode: "output", output: 0.5 });
  assert.ok(open.at(-1)!.pose.expressions.aa >= 0.9 * 0.8, `open to ${open.at(-1)!.pose.expressions.aa} of 0.8`);
  assert.ok(Math.abs(open.at(-1)!.pose.expressions.oh - 0.25 * open.at(-1)!.pose.expressions.aa) < 1e-9, "rounded a quarter as much");
  run(motion, 1, { mode: "output", output: 0.5 });
  const shut = run(motion, 0.2, { fps: 200, mode: "output", output: 0 });
  assert.ok(shut.at(-1)!.pose.expressions.aa <= 0.1 * 0.8, `shut to ${shut.at(-1)!.pose.expressions.aa}`);
  for (const mode of ["idle", "input", "thinking", "muted"] as AvatarMode[]) {
    const poses = run(createMotion(seeded(2)), 1, { mode, output: 0.9 });
    assert.equal(Math.max(...poses.map((p) => p.pose.expressions.aa)), 0, `shut while ${mode}`);
  }
  assert.equal(run(createMotion(seeded(3)), 1, { mode: "output", output: 1 }).at(-1)!.pose.expressions.aa > 0.99, true, "wide open at most");
});

test("it leans in only while the person is heard, and is drawn 8% nearer then", () => {
  // The neck, which only leaning moves, and how much nearer the camera is.
  const leaning = (mode: AvatarMode, reduced = false) => {
    const { bones, near } = run(createMotion(() => 0.5), 3, { mode, reduced }).at(-1)!.pose;
    return { neck: bones.neck[0], near };
  };
  assert.ok(Math.abs(leaning("input").neck - 0.06) < 0.001, `leaning ${leaning("input").neck}`);
  assert.ok(Math.abs(leaning("input").near - 0.08) < 0.001, `nearer by ${leaning("input").near}`);
  assert.ok(Math.abs(leaning("input", true).near - 0.04) < 0.001, `with reduced motion, by half: ${leaning("input", true).near}`);
  for (const mode of ["idle", "output", "thinking", "muted"] as AvatarMode[]) assert.deepEqual(leaning(mode), { neck: 0, near: 0 }, mode);
});

test("the thinking pose starts after 0.6 s of thinking, with a blink, and leaves as the mode changes", () => {
  const motion = createMotion(() => 0.99);
  const early = run(motion, THINK_AFTER - 0.02, { mode: "thinking", reduced: true });
  assert.ok(early.every((p) => p.pose.bones.head[1] === 0 && p.pose.gaze[0] === 0), "nothing yet");
  const later = run(motion, 2, { mode: "thinking", reduced: true });
  assert.ok(later.slice(0, 4).some((p) => p.pose.expressions.blink > 0), "a blink as it begins");
  const posed = later.at(-1)!.pose;
  // At half its angles: reduced motion.
  assert.ok(posed.bones.head[1] > 0.045 && posed.bones.head[1] < 0.06, `turned ${posed.bones.head[1]}`);
  assert.ok(posed.gaze[0] > 0.3 && posed.gaze[1] > 0.2, `looking aside and up, a third and a quarter of the eyes' way ${posed.gaze}`);
  const after = run(motion, 0.1, { mode: "output", reduced: true });
  assert.ok(after.at(-1)!.pose.bones.head[1] < posed.bones.head[1], "leaving");
  // A short thinking, the gap between two phrases, does not move the head.
  run(motion, 3, { mode: "output", reduced: true });
  const gap = run(motion, 0.5, { mode: "thinking", reduced: true });
  assert.ok(gap.at(-1)!.pose.bones.head[1] < 1e-3, `still ${gap.at(-1)!.pose.bones.head[1]}`);
});

test("it moves the same at 15, 30 and 60 frames a second", () => {
  const at = (fps: number) => {
    const motion = createMotion(() => 0.5);
    run(motion, 1, { fps, mode: "input" });
    run(motion, 1.6, { fps, mode: "thinking" });
    return run(motion, 1, { fps, mode: "output", output: 0.4 }).at(-1)!.pose;
  };
  const [slow, mid, fast] = [at(15), at(30), at(60)];
  for (const pose of [slow, mid]) {
    assert.ok(Math.abs(pose.expressions.aa - fast.expressions.aa) < 0.01, `mouth ${pose.expressions.aa} and ${fast.expressions.aa}`);
    for (const bone of Object.keys(fast.bones) as (keyof Pose["bones"])[]) {
      fast.bones[bone].forEach((angle, axis) => assert.ok(Math.abs(pose.bones[bone][axis] - angle) < 0.002, `${bone}[${axis}]: ${pose.bones[bone][axis]} and ${angle}`));
    }
    assert.ok(Math.abs(pose.gaze[0] - fast.gaze[0]) < 0.005 && Math.abs(pose.gaze[1] - fast.gaze[1]) < 0.005, "the gaze");
  }
});

test("with reduced motion there is no breathing, sway or saccade, and lean and thinking are at half", () => {
  const still = run(createMotion(seeded(4)), 10, { reduced: true });
  for (const { pose } of still) {
    assert.deepEqual(pose.bones.spine, [0, 0, 0]);
    assert.deepEqual(pose.bones.chest, [0, 0, 0]);
    assert.deepEqual(pose.bones.head, [0, 0, 0]);
    assert.deepEqual(pose.gaze, [0, 0]);
  }
  assert.ok(still.some((p) => p.pose.expressions.blink > 0), "it still blinks");
  const moving = run(createMotion(seeded(4)), 10);
  assert.ok(moving.some((p) => Math.abs(p.pose.bones.chest[0]) > 0.01), "it breathes");
  assert.ok(moving.some((p) => Math.abs(p.pose.bones.head[1]) > 0.03), "it sways");
  assert.ok(moving.some((p) => p.pose.gaze[0] !== 0), "its eyes move");
  const lean = (reduced: boolean) => run(createMotion(() => 0.5), 3, { mode: "input", reduced }).at(-1)!.pose.bones.neck[0];
  assert.ok(Math.abs(lean(true) - lean(false) / 2) < 0.001, `half: ${lean(true)} of ${lean(false)}`);
  // The arms are down either way.
  assert.equal(still[0].pose.bones.leftUpperArm[2], -1.2);
  assert.equal(still[0].pose.bones.rightUpperArm[2], 1.2);
});
