import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarMode } from "@pithagoras/extension-api";
import { THINK_HAND_AFTER, THINK_TRY, WAVE, type ClipGesture } from "../src/gestures.ts";
import { DEFAULT_SETTINGS, type ModelSettings } from "../src/model-settings.ts";
import { createMotion, type Pose } from "../src/motion.ts";

/**
 * The gestures, through the motion as the stage steps it: the beats as it speaks, the nods as it listens, the stirs
 * as it waits, the wave and the hand to the chin, and the clips played for them. Breathing is off in these, so what
 * moves is the gestures.
 */

/** The same numbers every run: a small linear congruential generator. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Run = {
  fps?: number;
  mode?: AvatarMode;
  /** The loudness of the side heard in `mode` (the person while `input`, the reply while `output`), by the time in this run. */
  level?: (t: number) => number;
  reduced?: boolean;
  set?: Partial<ModelSettings>;
  clips?: Partial<Record<ClipGesture, number>>;
  /** A gesture asked for at the first step. */
  cue?: ClipGesture;
};

/** Runs `motion` for `seconds` and gives every pose with the time in this run. */
function run(motion: ReturnType<typeof createMotion>, seconds: number, { fps = 60, mode = "idle", level = () => 0, reduced = false, set = {}, clips = {}, cue }: Run = {}) {
  const poses: { t: number; pose: Pose }[] = [];
  const dt = 1 / fps;
  const settings = { ...DEFAULT_SETTINGS, breathing: 0, ...set };
  for (let i = 1; i <= Math.round(seconds * fps); i++) {
    const t = i * dt;
    const heard = level(t);
    const pose = motion.step({ mode, input: mode === "input" ? heard : 0, output: mode === "output" ? heard : 0, dt, reduced, settings, clips, cue: i === 1 ? cue : undefined });
    poses.push({ t, pose: structuredClone(pose) });
  }
  return poses;
}

/** Syllables four a second inside slower phrases, and a stressed one, twice as loud, every 1.5 s. */
const stressed = (t: number) => Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * (t % 1.5 < 0.25 ? 0.9 : 0.35);
/** Talk for `on` seconds, then quiet for `off`, over and over. */
const talk = (on: number, off: number) => (t: number) => (t % (on + off) < on ? 0.3 + 0.2 * Math.abs(Math.sin(9 * t)) : 0);

/** A motion that has begun the conversation (heard the person), so it does not wave as it starts. */
function begun(seed = 1) {
  const motion = createMotion(seeded(seed));
  run(motion, 0.1, { mode: "input" });
  return motion;
}

/** When something rises past `over` after being under it: the steps a beat or a nod begins in, by `of` each pose. */
const rises = (poses: { t: number; pose: Pose }[], of: (pose: Pose) => number, over: number) =>
  poses.filter((p, i) => i > 0 && of(p.pose) > over && of(poses[i - 1].pose) <= over).map((p) => p.t);

test("speaking, its head dips and a hand flicks on the stressed syllables, never two beats within 0.55 s", () => {
  const poses = run(begun(), 30, { mode: "output", level: stressed });
  // The beat flicks a forearm forward over where it is held while it speaks: the right's y up, the left's down.
  const flick = (pose: Pose) => Math.max(pose.bones.rightLowerArm[1], -pose.bones.leftLowerArm[1]);
  const held = poses.at(-1)!.pose.bones.rightLowerArm[1];
  const beats = rises(poses, (pose) => flick(pose) - held, 0.05);
  assert.ok(beats.length >= 12 && beats.length <= 21, `${beats.length} beats in 30 s, a stress every 1.5 s`);
  for (const at of beats) assert.ok(at % 1.5 < 0.5, `a beat at ${at.toFixed(2)} s, on a stress`);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  assert.ok(gaps.every((g) => g > 0.55), `gaps from ${Math.min(...gaps)}`);
  // The head dips with them: further forward than the nodding with the voice goes alone.
  const still = run(begun(), 30, { mode: "output", level: stressed, set: { gestures: 0 } });
  const dips = poses.map((p, i) => p.pose.bones.head[0] - still[i].pose.bones.head[0]);
  assert.ok(Math.max(...dips) > 0.02, `the head dips by ${Math.max(...dips)}`);
  // An even voice has no stress after its first syllables.
  const even = run(begun(), 15, { mode: "output", level: (t) => Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * 0.6 });
  const evenBeats = rises(even.filter((p) => p.t > 4), (pose) => flick(pose) - held, 0.05);
  assert.deepEqual(evenBeats, [], "no beat in an even voice");
});

test("two stressed syllables in a row are one beat", () => {
  // Two loud syllables (0.25 s apart) every 3 s, among soft ones.
  const twice = (t: number) => Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * (t % 3 < 0.5 ? 0.9 : 0.35);
  const poses = run(begun(), 30, { mode: "output", level: twice });
  const held = poses.at(-1)!.pose.bones.rightLowerArm[1];
  const beats = rises(poses, (pose) => Math.max(pose.bones.rightLowerArm[1], -pose.bones.leftLowerArm[1]) - held, 0.05);
  assert.ok(beats.length >= 8 && beats.length <= 10, `${beats.length} beats in 30 s: ${beats.map((b) => b.toFixed(2))}`);
});

test("speaking, both forearms come up a little, and go back down when it stops", () => {
  const motion = begun();
  const speaking = run(motion, 3, { mode: "output", level: stressed }).at(-1)!.pose;
  assert.ok(speaking.bones.rightLowerArm[1] > 0.25 && speaking.bones.leftLowerArm[1] < -0.25, `forearms at ${speaking.bones.rightLowerArm} and ${speaking.bones.leftLowerArm}`);
  const after = run(motion, 3, { mode: "input" }).at(-1)!.pose;
  assert.ok(Math.abs(after.bones.rightLowerArm[1]) < 0.01 && Math.abs(after.bones.leftLowerArm[1]) < 0.01, `forearms at ${after.bones.rightLowerArm} and ${after.bones.leftLowerArm}`);
});

test("listening, it nods every 2 to 5 seconds of the person's talk, and once at each pause in it", () => {
  // 4 s of talk and 1.5 s of quiet, five times.
  const poses = run(begun(2), 27.5, { mode: "input", level: talk(4, 1.5) });
  // The spine leans in as it listens: a lean back is against where it is with no gestures.
  const none = run(begun(2), 27.5, { mode: "input", level: talk(4, 1.5), set: { gestures: 0 } });
  const nods = rises(poses, (pose) => pose.bones.head[0], 0.02);
  const leanBacks = rises(poses.map((p, i) => ({ t: p.t, pose: { ...p.pose, bones: { ...p.pose.bones, spine: [p.pose.bones.spine[0] - none[i].pose.bones.spine[0], 0, 0] } } as Pose })), (pose) => -pose.bones.spine[0], 0.01);
  const inTalk = nods.filter((t) => t % 5.5 < 4);
  const atPause = [...nods, ...leanBacks].filter((t) => t % 5.5 >= 4.4 && t % 5.5 < 5.2);
  assert.ok(inTalk.length >= 3, `${inTalk.length} nods while the person talks: ${nods.map((n) => n.toFixed(2))}`);
  assert.equal(atPause.length, 5, `a nod or a lean back 0.45 s into each pause: ${nods.map((n) => n.toFixed(2))} and ${leanBacks.map((n) => n.toFixed(2))}`);
  // Nothing in the rest of a pause.
  assert.equal([...nods, ...leanBacks].filter((t) => t % 5.5 >= 4 && t % 5.5 < 4.4).length, 0);
});

test("when the person stops and voice mode moves on, it nods once for what they said", () => {
  const motion = begun(3);
  run(motion, 2, { mode: "input", level: () => 0.5 });
  const after = run(motion, 2, { mode: "thinking", set: { thinkingPose: false } });
  assert.equal(rises(after, (pose) => pose.bones.head[0], 0.02).length, 1);
  // A few words are not enough to nod at.
  const short = begun(3);
  run(short, 0.5, { mode: "input", level: () => 0.5 });
  assert.equal(rises(run(short, 2, { mode: "thinking", set: { thinkingPose: false } }), (pose) => pose.bones.head[0], 0.02).length, 0);
});

test("waiting, it stirs every 5 to 12 seconds, shifts its weight from one foot to the other, and not while it speaks", () => {
  const poses = run(begun(4), 120, { mode: "idle", fps: 30 });
  const lean = poses.map((p) => p.pose.bones.spine[2]);
  assert.ok(lean.some((z) => z > 0.02) && lean.some((z) => z < -0.02), `the weight on both sides: ${Math.min(...lean)} to ${Math.max(...lean)}`);
  // Each stir moves the head: the tilt and the stretch start a movement, and a shift of weight tips it.
  const tilts = rises(poses, (pose) => Math.abs(pose.bones.head[2]) + Math.abs(pose.bones.chest[0]), 0.012);
  assert.ok(tilts.length >= 6, `${tilts.length} stirs in two minutes`);
  // None before 5 s: the first is 5 to 12 s in.
  assert.ok(tilts[0] >= 5, `the first at ${tilts[0]}`);
  const speaking = run(begun(4), 60, { mode: "output", level: () => 0, fps: 30 });
  assert.ok(speaking.every((p) => p.pose.bones.spine[2] === 0 && p.pose.bones.head[2] === 0), "no stir while it speaks");
});

test("it waves once as voice mode starts, with the right hand, and not once the conversation has begun", () => {
  const motion = createMotion(seeded(5));
  const poses = run(motion, 4, { mode: "idle" });
  // The right forearm up: bent far at the elbow.
  const waving = (pose: Pose) => pose.bones.rightLowerArm[1] > 1.5;
  const first = poses.find((p) => waving(p.pose));
  assert.ok(first && first.t > 0.6 && first.t < 1.2, `it waves from ${first?.t}`);
  const last = poses.findLast((p) => waving(p.pose))!;
  assert.ok(last.t > 2.2 && last.t < 0.6 + WAVE, `until ${last.t}`);
  assert.ok(poses.every((p) => p.pose.bones.leftLowerArm[1] > -0.5), "the left arm stays down");
  // Not again, when it waits after a turn.
  run(motion, 3, { mode: "input", level: () => 0.5 });
  assert.ok(run(motion, 5, { mode: "idle" }).every((p) => !waving(p.pose)), "once");
  // Not when the person spoke first.
  assert.ok(run(begun(), 5, { mode: "idle" }).every((p) => !waving(p.pose)), "not after the conversation began");
});

test("on a long think a hand goes to the chin, after 2.5 s, and comes down when the thinking ends", () => {
  const motion = begun(6);
  const thinking = run(motion, 6, { mode: "thinking" });
  const up = (pose: Pose) => pose.bones.rightLowerArm[1];
  assert.ok(thinking.filter((p) => p.t < THINK_HAND_AFTER).every((p) => up(p.pose) < 0.01), "not before 2.5 s");
  assert.ok(Math.abs(up(thinking.at(-1)!.pose) - 2.1) < 0.02, `bent to ${up(thinking.at(-1)!.pose)}`);
  const after = run(motion, 1.5, { mode: "input" });
  assert.ok(up(after.at(-1)!.pose) < 0.01, `down again to ${up(after.at(-1)!.pose)}`);
});

test("a clip for a gesture is played in its place: by its weight, from its start, and the arm left as the pose has it", () => {
  const motion = createMotion(seeded(7));
  const poses = run(motion, 4, { mode: "idle", clips: { greeting: 1.5 } });
  const played = poses.filter((p) => p.pose.clip);
  assert.ok(played.every((p) => p.pose.clip!.gesture === "greeting"));
  assert.ok(Math.abs(played[0].t - 0.6) < 0.03 && Math.abs(played.at(-1)!.t - 2.1) < 0.03, `from ${played[0].t} to ${played.at(-1)!.t}`);
  for (const p of played) {
    assert.ok(Math.abs(p.pose.clip!.time - (p.t - played[0].t)) < 0.02, `at ${p.pose.clip!.time} of the clip ${p.t - played[0].t} s in`);
    assert.ok(p.pose.clip!.weight > 0 && p.pose.clip!.weight <= 1);
  }
  const middle = played.find((p) => p.t > 1.2)!;
  assert.ok(middle.pose.clip!.weight > 0.99, `at its full: ${middle.pose.clip!.weight}`);
  assert.ok(poses.every((p) => p.pose.bones.rightLowerArm[1] < 0.01), "no wave of its own");
  // The thinking clip: from its start once the think is long, held at its end, and faded out after.
  const thinker = begun(7);
  const thinking = run(thinker, 6, { mode: "thinking", clips: { thinking: 1 } }).filter((p) => p.pose.clip);
  assert.ok(Math.abs(thinking[0].t - THINK_HAND_AFTER) < 0.03, `from ${thinking[0].t}`);
  assert.equal(thinking.at(-1)!.pose.clip!.time, 1, "held at its last frame");
  assert.ok(thinking.at(-1)!.pose.clip!.weight > 0.95);
  const fading = run(thinker, 1.5, { mode: "output", level: () => 0, clips: { thinking: 1 } });
  assert.ok(fading[0].pose.clip && fading[0].pose.clip.weight < thinking.at(-1)!.pose.clip!.weight, "fading");
  assert.equal(fading.at(-1)!.pose.clip, undefined, "gone");
});

test("Try makes a gesture whatever the mode: the wave now, the hand to the chin for 3 s", () => {
  const wave = run(begun(8), 2, { mode: "output", level: () => 0, cue: "greeting" });
  assert.ok(wave.some((p) => p.pose.bones.rightLowerArm[1] > 1.5), "it waves");
  const chin = run(begun(8), THINK_TRY + 1.5, { mode: "output", level: () => 0, cue: "thinking" });
  const without = run(begun(8), THINK_TRY + 1.5, { mode: "output", level: () => 0 });
  assert.ok(chin.some((p) => p.pose.bones.rightLowerArm[1] > 1.9), "the hand goes to the chin");
  assert.ok(chin.filter((p) => p.t < THINK_TRY).at(-1)!.pose.bones.rightLowerArm[1] > 1.9, "for 3 s");
  assert.ok(Math.abs(chin.at(-1)!.pose.bones.rightLowerArm[1] - without.at(-1)!.pose.bones.rightLowerArm[1]) < 0.01, "and comes down after");
  const clip = run(begun(8), 1, { mode: "output", level: () => 0, cue: "greeting", clips: { greeting: 1.2 } });
  assert.ok(clip.some((p) => p.pose.clip?.gesture === "greeting"), "its clip, where it has one");
});

test("with reduced motion, no gestures set or no motion set, there are none: no beat, nod, stir, wave, hand or clip", () => {
  const clips = { greeting: 1, thinking: 1 };
  for (const [what, options] of [["reduced motion", { reduced: true }], ["no gestures", { set: { gestures: 0 } }], ["no motion", { set: { motion: 0 } }]] as const) {
    const motion = createMotion(seeded(9));
    const poses = [
      ...run(motion, 30, { mode: "idle", clips, ...options }),
      ...run(motion, 10, { mode: "input", level: talk(3, 1), clips, ...options }),
      ...run(motion, 10, { mode: "output", level: stressed, clips, ...options }),
      ...run(motion, 6, { mode: "thinking", clips, ...options }),
      ...run(motion, 2, { mode: "output", cue: "greeting", clips, ...options }),
    ];
    for (const { t, pose } of poses) {
      assert.equal(pose.clip, undefined, `${what}: a clip at ${t}`);
      for (const bone of ["leftShoulder", "rightShoulder", "leftHand", "rightHand"] as const) assert.deepEqual(pose.bones[bone], [0, 0, 0], `${what}: ${bone} at ${t}`);
      assert.deepEqual(pose.bones.rightLowerArm, [0, 0, 0.15], `${what}: the right forearm at ${t}`);
      assert.deepEqual(pose.bones.leftLowerArm, [0, 0, -0.15], `${what}: the left forearm at ${t}`);
      assert.equal(pose.bones.spine[2], 0, `${what}: the weight at ${t}`);
    }
  }
});

test("the gestures are as large as they are set to", () => {
  // The head's dips on the beats and its nods, over what it does with none.
  const largest = (gestures: number, mode: AvatarMode, level: (t: number) => number) => {
    const none = run(begun(), 15, { mode, level, set: { gestures: 0 } });
    return Math.max(...run(begun(), 15, { mode, level, set: { gestures } }).map((p, i) => p.pose.bones.head[0] - none[i].pose.bones.head[0]));
  };
  for (const [mode, level] of [["output", stressed], ["input", talk(4, 1.5)]] as const) {
    const [usual, twice, half] = [largest(1, mode, level), largest(2, mode, level), largest(0.5, mode, level)];
    assert.ok(usual > 0.02, `${mode}: ${usual}`);
    assert.ok(Math.abs(twice / usual - 2) < 0.05 && Math.abs(half / usual - 0.5) < 0.05, `${mode}: ${half}, ${usual}, ${twice}`);
  }
});

test("the gestures move the same at 15, 30 and 60 frames a second", () => {
  const at = (fps: number) => {
    const motion = createMotion(() => 0.5);
    // Whole frames at 15 a second.
    const wave = run(motion, 1.6, { fps, mode: "idle" }).at(-1)!.pose;
    run(motion, 2, { fps, mode: "input", level: () => 0.5 });
    const chin = run(motion, 4, { fps, mode: "thinking" }).at(-1)!.pose;
    return [wave, chin];
  };
  const [slow, mid, fast] = [at(15), at(30), at(60)];
  for (const poses of [slow, mid]) {
    poses.forEach((pose, i) => {
      for (const bone of ["rightUpperArm", "rightLowerArm", "rightHand", "head"] as const) {
        fast[i].bones[bone].forEach((angle, axis) => assert.ok(Math.abs(pose.bones[bone][axis] - angle) < 0.03, `${bone}[${axis}]: ${pose.bones[bone][axis]} and ${angle}`));
      }
    });
  }
});
