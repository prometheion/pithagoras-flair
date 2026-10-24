import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarMode } from "@pithagoras/extension-api";
import { DEFAULT_SETTINGS, type ModelSettings } from "../src/model-settings.ts";
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

/**
 * Runs `motion` for `seconds` at `fps` in `mode`, the person heard at `input` and the reply at `output`, with what is
 * `set` on the model over its defaults and the gesture `clips` it has, and gives every pose with its time.
 */
function run(
  motion: ReturnType<typeof createMotion>,
  seconds: number,
  { fps = 60, mode = "idle" as AvatarMode, input = 0, output = 0, reduced = false, set = {} as Partial<ModelSettings>, clips = {} } = {},
) {
  const poses: { t: number; pose: Pose }[] = [];
  const dt = 1 / fps;
  const settings = { ...DEFAULT_SETTINGS, ...set };
  for (let i = 1; i <= Math.round(seconds * fps); i++) poses.push({ t: i * dt, pose: motion.step({ mode, input, output, dt, reduced, settings, clips }) });
  return poses;
}

/** How open the mouth is, whatever its shape: the widest of the five. */
const opened = (pose: Pose) => Math.max(pose.expressions.aa, pose.expressions.ih, pose.expressions.ou, pose.expressions.ee, pose.expressions.oh);

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

test("with mouth shapes off, the mouth opens with the reply within 60 ms, shuts within 200 ms, and stays shut unless the reply is played", () => {
  const set = { mouthShapes: false };
  const motion = createMotion(seeded(1));
  const open = run(motion, 0.06, { fps: 200, mode: "output", output: 0.5, set });
  assert.ok(open.at(-1)!.pose.expressions.aa >= 0.9 * 0.8, `open to ${open.at(-1)!.pose.expressions.aa} of 0.8`);
  assert.ok(Math.abs(open.at(-1)!.pose.expressions.oh - 0.25 * open.at(-1)!.pose.expressions.aa) < 1e-9, "rounded a quarter as much");
  assert.deepEqual([open.at(-1)!.pose.expressions.ih, open.at(-1)!.pose.expressions.ou, open.at(-1)!.pose.expressions.ee], [0, 0, 0], "no other shape");
  run(motion, 1, { mode: "output", output: 0.5, set });
  const shut = run(motion, 0.2, { fps: 200, mode: "output", output: 0, set });
  assert.ok(shut.at(-1)!.pose.expressions.aa <= 0.1 * 0.8, `shut to ${shut.at(-1)!.pose.expressions.aa}`);
  for (const mode of ["idle", "input", "thinking", "muted"] as AvatarMode[]) {
    for (const mouthShapes of [false, true]) {
      const poses = run(createMotion(seeded(2)), 1, { mode, input: 0.9, output: 0.9, set: { mouthShapes } });
      assert.equal(Math.max(...poses.map((p) => opened(p.pose))), 0, `shut while ${mode}`);
    }
  }
  assert.equal(run(createMotion(seeded(3)), 1, { mode: "output", output: 1, set }).at(-1)!.pose.expressions.aa > 0.99, true, "wide open at most");
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

// What is set on the model.

const MODES: AvatarMode[] = ["idle", "input", "output", "thinking", "muted"];
const settle = (seconds: number, options: Parameters<typeof run>[2]) => run(createMotion(() => 0.5), seconds, options).at(-1)!.pose;

test("the mouth opens as wide as its sensitivity says for the same loudness", () => {
  const open = (mouth: number, output: number) => settle(1, { mode: "output", output, set: { mouth, mouthShapes: false } }).expressions.aa;
  assert.ok(Math.abs(open(2, 0.2) - 0.64) < 0.005, `twice as wide: ${open(2, 0.2)}`);
  assert.ok(Math.abs(open(2, 0.5) - 1) < 0.005, `wide open at most: ${open(2, 0.5)}`);
  assert.ok(Math.abs(open(0.5, 0.5) - 0.4) < 0.005, `half as wide: ${open(0.5, 0.5)}`);
  assert.ok(Math.abs(open(1, 0.5) - 0.8) < 0.005, `as it was: ${open(1, 0.5)}`);
});

test("with no motion set it neither breathes, sways, moves its eyes, nods, leans nor takes the thinking pose; it still blinks and speaks", () => {
  for (const mode of MODES) {
    const poses = run(createMotion(seeded(5)), 10, { mode, output: 0.6, set: { motion: 0 } });
    for (const { pose } of poses) {
      for (const bone of ["spine", "chest", "neck", "head"] as const) assert.ok(pose.bones[bone].every((angle) => angle === 0), `${mode}: ${bone} ${pose.bones[bone]}`);
      assert.equal(pose.bones.leftUpperArm[2], -1.2, mode);
      assert.ok(pose.gaze.every((g) => g === 0), `${mode}: gaze ${pose.gaze}`);
      assert.equal(pose.near, 0, mode);
    }
    assert.ok(poses.some((p) => p.pose.expressions.blink > 0), `${mode}: it blinks`);
    if (mode === "output") assert.ok(poses.some((p) => opened(p.pose) > 0.5), "it speaks");
  }
});

test("breathing and sway scale the chest and the head's sway, not the lean", () => {
  const still = run(createMotion(seeded(6)), 10, { mode: "input", set: { breathing: 0 } });
  // No angle at all: none at the sine's negative half either, where its share is -0.
  for (const { pose } of still) assert.ok(pose.bones.chest[0] === 0 && pose.bones.head[0] === 0 && pose.bones.head[1] === 0, `${pose.bones.chest} ${pose.bones.head}`);
  // The spine still leans in, with nothing of the breath on it.
  assert.ok(Math.abs(still.at(-1)!.pose.bones.spine[0] - 0.08) < 0.001, `leaning ${still.at(-1)!.pose.bones.spine[0]}`);
  const chest = (breathing: number) => Math.max(...run(createMotion(seeded(6)), 10, { set: { breathing } }).map((p) => p.pose.bones.chest[0]));
  assert.ok(Math.abs(chest(2) / chest(1) - 2) < 1e-9, `twice as deep: ${chest(2)} and ${chest(1)}`);
});

test("leaning in goes as far as it is set to", () => {
  const leaning = (lean: number) => {
    const { bones, near } = settle(3, { mode: "input", set: { lean } });
    return { neck: bones.neck[0], near };
  };
  assert.ok(Math.abs(leaning(2).neck - 0.12) < 0.001 && Math.abs(leaning(2).near - 0.16) < 0.001, `twice as far: ${JSON.stringify(leaning(2))}`);
  assert.deepEqual(leaning(0), { neck: 0, near: 0 });
});

test("with the thinking pose switched off, thinking looks as idle does, with no blink as it would begin", () => {
  const thinking = run(createMotion(() => 0.99), 3, { mode: "thinking", reduced: true, set: { thinkingPose: false } });
  const idle = run(createMotion(() => 0.99), 3, { mode: "idle", reduced: true, set: { thinkingPose: false } });
  assert.deepEqual(thinking.map((p) => p.pose), idle.map((p) => p.pose));
  // `random` 0.99 puts the first blink of its own at 5.96 s: none in these 3 s.
  assert.ok(thinking.every((p) => p.pose.expressions.blink === 0), "no blink");
  assert.ok(run(createMotion(() => 0.99), 3, { mode: "thinking", reduced: true }).some((p) => p.pose.expressions.blink > 0), "with it on, the blink");
});

test("it blinks as often as its rate says, each blink as long as before, and a new rate applies from then on", () => {
  const blinks = (blinkRate: number) => blinkStarts(run(createMotion(seeded(9)), 600, { fps: 200, set: { blinkRate } }));
  const usual = blinks(1).length;
  for (const rate of [2, 0.5]) {
    const n = blinks(rate).length;
    assert.ok(Math.abs(n / usual - rate) < 0.15 * rate, `${n} blinks at ${rate}, ${usual} at 1`);
  }
  // Each still shut at its middle and open again 0.15 s after it began.
  const fast = run(createMotion(seeded(9)), 60, { fps: 200, set: { blinkRate: 2 } });
  for (const start of blinkStarts(fast).slice(0, 10)) {
    const at = fast.findIndex((p) => p.t >= start);
    assert.ok(Math.max(...fast.slice(at, at + 30).map((p) => p.pose.expressions.blink)) > 0.95, `shut at ${start}`);
    assert.equal(fast.find((p) => p.t >= start + BLINK + 0.006)!.pose.expressions.blink, 0, `open again after ${start}`);
  }
  // Ten minutes at the usual rate, then ten at twice it, on one motion: the second ten have twice the blinks.
  const motion = createMotion(seeded(9));
  const first = blinkStarts(run(motion, 600, { fps: 200 })).length;
  const second = blinkStarts(run(motion, 600, { fps: 200, set: { blinkRate: 2 } })).length;
  assert.ok(Math.abs(second / first - 2) < 0.3, `${first} then ${second}`);
});

test("the arms come down by the angle set", () => {
  const { bones } = run(createMotion(() => 0.5), 0.1, { reduced: true, set: { armDown: 1 } })[0].pose;
  assert.deepEqual([bones.leftUpperArm[2], bones.rightUpperArm[2]], [-1, 1]);
});

test("a gaze set to wander moves the eyes further and more slowly while nothing is said, and back near the camera when something is", () => {
  const poses = run(createMotion(seeded(11)), 120, { fps: 100, set: { gaze: "around" } });
  const far = poses.map((p) => Math.hypot(...p.pose.gaze));
  assert.ok(far.some((r) => r > 0.2), `furthest ${Math.max(...far)}`);
  assert.ok(far.every((r) => r <= 0.6 + 1e-9), `furthest ${Math.max(...far)}`);
  // When the eyes jump: the steps where the gaze changed.
  const jumps = poses.filter((p, i) => i > 0 && (p.pose.gaze[0] !== poses[i - 1].pose.gaze[0] || p.pose.gaze[1] !== poses[i - 1].pose.gaze[1])).map((p) => p.t);
  const gaps = jumps.slice(1).map((j, i) => j - jumps[i]);
  assert.ok(gaps.length > 20 && gaps.every((g) => g >= 1.5 - 0.011 && g <= 4 + 0.011), `gaps ${Math.min(...gaps)} to ${Math.max(...gaps)}`);
  // Muted is as idle; listening and speaking bring the eyes back in the step they begin.
  for (const mode of ["input", "output"] as AvatarMode[]) {
    const motion = createMotion(seeded(12));
    const wandered = run(motion, 30, { mode: "muted", set: { gaze: "around" } });
    assert.ok(wandered.some((p) => Math.hypot(...p.pose.gaze) > 0.2), "wandering while muted");
    for (const { pose } of run(motion, 10, { mode, set: { gaze: "around" } })) assert.ok(Math.hypot(...pose.gaze) <= 0.2 + 1e-9, `${mode}: ${pose.gaze}`);
  }
  // At the person, as before.
  assert.ok(run(createMotion(seeded(11)), 120, { fps: 100 }).every((p) => Math.hypot(...p.pose.gaze) <= 0.2 + 1e-9));
});

test("reduced motion comes first: more motion set does not bring back breathing, sway or the eyes', nor lean or turn further than half, and less motion set lowers them", () => {
  const set = { breathing: 2, motion: 1.5 };
  for (const { pose } of run(createMotion(seeded(4)), 10, { reduced: true, set })) {
    assert.deepEqual(pose.bones.chest, [0, 0, 0]);
    assert.deepEqual(pose.bones.head, [0, 0, 0]);
    assert.deepEqual(pose.gaze, [0, 0]);
  }
  // Half of what the defaults give, as with no settings: 0.06 for the neck leaning in, 0.12 for the head turned thinking.
  const neck = (given: Partial<ModelSettings>) => settle(3, { mode: "input", reduced: true, set: given }).bones.neck[0];
  const turned = (given: Partial<ModelSettings>) => settle(3, { mode: "thinking", reduced: true, set: given }).bones.head[1];
  assert.ok(Math.abs(neck({ ...set, lean: 2 }) - 0.06 * 0.5) < 0.001, `the neck at ${neck({ ...set, lean: 2 })}`);
  assert.ok(Math.abs(turned(set) - 0.12 * 0.5) < 0.001, `the head at ${turned(set)}`);
  assert.ok(Math.abs(neck({ motion: 0.5, lean: 1.2 }) - 0.06 * 0.5 * 0.5 * 1.2) < 0.001, `the neck at ${neck({ motion: 0.5, lean: 1.2 })}`);
  assert.ok(Math.abs(turned({ motion: 0.5 }) - 0.12 * 0.5 * 0.5) < 0.001, `the head at ${turned({ motion: 0.5 })}`);
});

test("with settings of its own it moves the same at 15, 30 and 60 frames a second", () => {
  const set = { motion: 1.3, breathing: 1.6, lean: 1.8, mouth: 1.5, armDown: 1.0, blinkRate: 1.7 };
  const at = (fps: number) => {
    const motion = createMotion(() => 0.5);
    run(motion, 1, { fps, mode: "input", set });
    run(motion, 1.6, { fps, mode: "thinking", set });
    return run(motion, 1, { fps, mode: "output", output: 0.4, set }).at(-1)!.pose;
  };
  const [slow, mid, fast] = [at(15), at(30), at(60)];
  for (const pose of [slow, mid]) {
    assert.ok(Math.abs(pose.expressions.aa - fast.expressions.aa) < 0.01, `mouth ${pose.expressions.aa} and ${fast.expressions.aa}`);
    for (const bone of Object.keys(fast.bones) as (keyof Pose["bones"])[]) {
      fast.bones[bone].forEach((angle, axis) => assert.ok(Math.abs(pose.bones[bone][axis] - angle) < 0.003, `${bone}[${axis}]: ${pose.bones[bone][axis]} and ${angle}`));
    }
    assert.ok(Math.abs(pose.gaze[0] - fast.gaze[0]) < 0.007 && Math.abs(pose.gaze[1] - fast.gaze[1]) < 0.007, "the gaze");
  }
});
