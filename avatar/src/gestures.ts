import type { AvatarMode } from "@pithagoras/extension-api";
import { damp, pulse, smooth } from "./ease";

/**
 * The avatar's gestures, from what voice mode is doing and how loud each side is: added to the pose motion.ts makes
 * of breathing, sway, leaning in and the thinking pose. Pure, so it is tested on its own; `random` is what chooses
 * when and which.
 *
 * - While it speaks, its forearms come up a little, as a speaker's do, and on a stressed syllable (one louder by a
 *   margin than the syllables have got in the last few seconds) the head dips and a hand flicks, one or the other or
 *   both, never more than one beat in 0.55 to 1.45 seconds.
 * - While the person talks, it nods now and then, every 2 to 5 seconds of their speech, and at a pause in it (0.45 s
 *   quiet after a second or more of talk), or when they stop and voice mode moves on, it nods, or now and then leans
 *   back a little, once.
 * - While nothing is said, every 5 to 12 seconds it shifts its weight to the other foot, stretches, or tilts its head,
 *   so the wait is not one loop. A shift of weight stays until the next.
 * - It waves the first time it waits, as voice mode starts (not once the conversation has begun), and on a long think
 *   (2.5 s and more) it brings a hand up to its chin until the thinking ends.
 *
 * The wave and the hand to the chin can be VRM Animation clips uploaded for the model (`CLIP_GESTURES`): where one is
 * given, by its length in seconds, the gesture is the clip, which the stage plays over the pose by the weight this says
 * (`clip`), and the arm is left as it is. The angles are radians on three-vrm's normalized bones, as in motion.ts.
 */

/** The gestures a clip can be uploaded for: the wave as voice mode starts, and the hand to the chin on a long think. */
export const CLIP_GESTURES = ["greeting", "thinking"] as const;
export type ClipGesture = (typeof CLIP_GESTURES)[number];

/** The bones the gestures move: the ones motion.ts moves, the shoulders (optional in VRM, skipped where a model has none) and the hands. */
export type GestureBone =
  | "spine" | "chest" | "neck" | "head"
  | "leftShoulder" | "rightShoulder" | "leftUpperArm" | "rightUpperArm" | "leftLowerArm" | "rightLowerArm" | "leftHand" | "rightHand";
export type Bones = Record<GestureBone, [number, number, number]>;
export const BONES: readonly GestureBone[] = [
  "spine", "chest", "neck", "head",
  "leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm", "leftHand", "rightHand",
];

/** How long the built-in wave lasts, and how long a long think has to be before the hand goes to the chin. */
export const WAVE = 2.2;
export const THINK_HAND_AFTER = 2.5;
/** How long the cue from the Settings page's Try button holds the hand to the chin. */
export const THINK_TRY = 3;

/**
 * The right arm in each held gesture, as an upper arm and a forearm pointing where the gesture needs them, the elbow
 * bending about its own hinge (the lower arm turned about its y alone): the wave beside the face, the hand at the chin,
 * and the forearm brought forward as a speaker holds it. Found on pixiv's and VRoid's sample models, VRM 1.0 and 0.x
 * alike, whose arms are in the same proportion to the body: the hand lands within a few centimetres of the same place
 * on each. The left arm is the mirror image: y and z reversed.
 */
const WAVE_ARM = { upper: [-1.123, -0.523, 0.511], lower: [0, 2.286, 0] } as const;
const CHIN_ARM = { upper: [-0.731, 0.528, 1.743], lower: [0, 2.1, 0] } as const;
const READY_ARM = { upper: [-0.093, 0.103, 1.266], lower: [0, 0.986, 0] } as const;

export interface GestureInput {
  mode: AvatarMode;
  /** How loud the person is heard now, 0 to 1. */
  input: number;
  /** How loud the reply is, eased as the mouth follows it (mouth.ts). */
  level: number;
  /** Seconds since the last step, and since the motion started. */
  dt: number;
  t: number;
  /** How long the mode has been thinking, 0 in any other. */
  thinking: number;
  /** How much of every gesture, as a factor: 0 is none (reduced motion, no motion or no gestures set). */
  amount: number;
  /** The clips the model has, each by its length in seconds. */
  clips: Partial<Record<ClipGesture, number>>;
  /** A gesture to make now, whatever the mode: the Settings page's Try. */
  cue?: ClipGesture;
}

/** The clip to play over the pose, from `time` seconds into it, by `weight` (0 to 1). */
export type ClipPlay = { gesture: ClipGesture; time: number; weight: number };

export function createGestures(random: () => number) {
  // Speaking: the forearms held up, the syllables' usual loudness the stresses are measured against, and the last beat.
  let talking = 0;
  let usual = 0;
  let nextBeat = 0;
  let beat = { at: -Infinity, strength: 0, left: 0, right: 0, turn: 0 };
  // Listening: the person's loudness eased, how long they have talked since the last reaction and been quiet now,
  // when the next nod during their talk is due (by their talk's clock), the nods under way and the last lean back.
  let heard = 0;
  let talked = 0;
  let quiet = 0;
  let nextNod = 2 + 3 * random();
  let nods: { at: number; strength: number }[] = [];
  let leanBackAt = -Infinity;
  let was: AvatarMode = "idle";
  // Waiting: when the next stir is due, where the weight is shifting to and has got, the last stretch and tilt.
  let nextStir = 5 + 7 * random();
  let side = 0;
  let shift = 0;
  let stretchAt = -Infinity;
  let tilt = { at: -Infinity, side: 1 };
  // The wave, as voice mode starts: whether the conversation has begun, how long it has waited, and when it waved.
  let begun = false;
  let waited = 0;
  let waveAt = -Infinity;
  let waved = false;
  // The hand to the chin, eased in and out, since when it has been due, and until when a Try holds it.
  let chin = 0;
  let chinFrom = Infinity;
  let tryUntil = -Infinity;

  const nod = (at: number, strength: number) => {
    nods.push({ at, strength });
    if (random() < 0.3) nods.push({ at: at + 0.38, strength: 0.7 * strength });
  };

  return {
    /** Adds the gestures to `bones` (already holding the pose), and says the clip to play over it, if any. */
    step({ mode, input, level, dt, t, thinking, amount, clips, cue }: GestureInput, bones: Bones): ClipPlay | undefined {
      const waiting = mode === "idle" || mode === "muted";

      // Speaking.
      talking = damp(talking, mode === "output" ? 1 : 0, 2.5, dt);
      // How loud its syllables have got over the last few seconds: up towards each one's loudest, and slowly down after,
      // not over the gaps between them.
      if (mode !== "output") usual = damp(usual, 0, 1.5, dt);
      else if (level > 0.1) usual = damp(usual, level, level > usual ? 3 : 0.5, dt);
      if (mode === "output" && level > 0.3 && level > 1.3 * usual + 0.05 && t >= nextBeat) {
        const both = random() < 0.25;
        const left = both || random() < 0.5;
        beat = { at: t, strength: Math.min(1, (level - usual) / 0.4), left: left ? 1 : 0, right: both || !left ? 1 : 0, turn: random() - 0.5 };
        nextBeat = t + 0.55 + 0.9 * random();
      }

      // Listening.
      heard = damp(heard, mode === "input" ? input : 0, input > heard ? 25 : 6, dt);
      if (mode === "input" && heard > 0.12) {
        talked += dt;
        quiet = 0;
        if (talked >= nextNod) {
          nod(t, 0.6);
          nextNod = talked + 2 + 3 * random();
        }
      } else if (mode === "input") {
        quiet += dt;
        if (quiet >= 0.45 && talked >= 1.2) {
          if (random() < 0.7) nod(t, 1);
          else leanBackAt = t;
          talked = 0;
          nextNod = 2 + 3 * random();
        }
      }
      // They stopped and voice mode moved on: a nod for what was said, unless it was answered at a pause already.
      if (was === "input" && mode !== "input") {
        if (talked >= 1.2) nod(t, 1);
        talked = 0;
        quiet = 0;
        nextNod = 2 + 3 * random();
      }
      was = mode;
      nods = nods.filter((n) => t - n.at < 3);

      // Waiting.
      if (!waiting) nextStir = Math.max(nextStir, t + 3);
      else if (t >= nextStir) {
        const pick = random();
        if (pick < 0.4) side = side === 0 ? (random() < 0.5 ? -1 : 1) : random() < 0.3 ? 0 : -side;
        else if (pick < 0.6) stretchAt = t;
        else tilt = { at: t, side: random() < 0.5 ? -1 : 1 };
        nextStir = t + 5 + 7 * random();
      }
      shift = damp(shift, side, 0.9, dt);

      // The wave, once, as voice mode starts.
      if (mode === "input" || mode === "output" || mode === "thinking") begun = true;
      waited = waiting ? waited + dt : 0;
      if (!waved && !begun && waited >= 0.6) {
        waved = true;
        waveAt = t;
      }
      if (cue === "greeting") waveAt = t;
      if (cue === "thinking") tryUntil = t + THINK_TRY;
      const long = thinking >= THINK_HAND_AFTER || t < tryUntil;
      if (!long) chinFrom = Infinity;
      else if (chinFrom === Infinity) chinFrom = thinking >= THINK_HAND_AFTER ? t - (thinking - THINK_HAND_AFTER) : t;
      chin = damp(chin, long ? 1 : 0, long ? 3 : 5, dt);

      if (amount === 0) return undefined;
      const add = (bone: GestureBone, x: number, y: number, z: number) => {
        const b = bones[bone];
        b[0] += x;
        b[1] += y;
        b[2] += z;
      };

      // The forearms up while it speaks, and the beat: the head dips on the stress, the hands flick up and forward.
      const ready = 0.3 * talking * Math.min(1, amount);
      towards(bones, "right", READY_ARM, ready);
      towards(bones, "left", READY_ARM, ready);
      const flick = amount * beat.strength * pulse(t - beat.at, 0.18);
      const dip = amount * beat.strength * pulse(t - beat.at, 0.14);
      add("head", 0.035 * dip, 0.03 * beat.turn * dip, 0);
      add("rightLowerArm", 0, 0.25 * beat.right * flick, 0);
      add("leftLowerArm", 0, -0.25 * beat.left * flick, 0);
      add("rightUpperArm", -0.06 * beat.right * flick, 0, 0);
      add("leftUpperArm", -0.06 * beat.left * flick, 0, 0);
      add("rightHand", 0, 0, -0.2 * beat.right * flick);
      add("leftHand", 0, 0, 0.2 * beat.left * flick);

      // The nods and the lean back while it listens.
      let nodding = 0;
      for (const n of nods) nodding += n.strength * pulse(t - n.at, 0.2);
      add("head", 0.06 * amount * nodding, 0, 0);
      add("neck", 0.02 * amount * nodding, 0, 0);
      const back = amount * pulse(t - leanBackAt, 0.6);
      add("spine", -0.03 * back, 0, 0);
      add("head", -0.025 * back, 0, 0.03 * back);

      // The weight on one foot, the stretch and the tilt while it waits.
      const s = amount * shift;
      add("spine", 0, 0.015 * s, 0.03 * s);
      add("chest", 0, 0, -0.012 * s);
      add("head", 0, 0, -0.018 * s);
      const stretch = amount * pulse(t - stretchAt, 0.9);
      add("chest", -0.05 * stretch, 0, 0);
      add("neck", -0.03 * stretch, 0, 0);
      add("head", -0.04 * stretch, 0, 0);
      add("leftShoulder", 0, 0, 0.08 * stretch);
      add("rightShoulder", 0, 0, -0.08 * stretch);
      const tilted = amount * tilt.side * pulse(t - tilt.at, 0.7);
      add("head", 0, 0.05 * tilted, 0.07 * tilted);
      add("neck", 0, 0, 0.02 * tilted);

      // The wave and the hand to the chin: a clip where the model has one, else the arm.
      const full = Math.min(1, amount);
      const waving = t - waveAt;
      const waveLength = clips.greeting ?? WAVE;
      const wave = waving >= 0 && waving < waveLength ? full * smooth(waving / 0.4) * smooth((waveLength - waving) / 0.5) : 0;
      if (clips.thinking !== undefined && chin > 0.001) {
        // Held at its last frame while the thinking goes on, and as it fades out.
        return { gesture: "thinking", time: Math.min(chinFrom === Infinity ? clips.thinking : t - chinFrom, clips.thinking), weight: full * chin };
      }
      if (clips.greeting !== undefined && wave > 0) return { gesture: "greeting", time: waving, weight: wave };
      if (clips.thinking === undefined) {
        towards(bones, "right", CHIN_ARM, full * chin);
        // The wrist bent back, so the fingers come to the chin rather than over the mouth.
        add("rightHand", 0, -0.6 * full * chin, 0);
        add("head", 0.04 * full * chin, 0, 0);
      }
      if (clips.greeting === undefined && wave > 0) {
        towards(bones, "right", WAVE_ARM, wave);
        const swing = Math.sin(2 * Math.PI * 2.2 * waving) * wave;
        add("rightLowerArm", 0, 0.15 * swing, 0);
        add("rightHand", 0, 0.35 * swing, 0);
        add("head", 0, 0, 0.04 * wave);
      }
      return undefined;
    },
  };
}

/**
 * One arm moved `weight` of the way from where the pose has it to the gesture's angles: the right arm's, or their
 * mirror image for the left. Each bone turns along the shortest way between the two (a slerp of their quaternions), so
 * the arm goes up to the chin or the wave the way an arm does, not through the twists a blend of each angle on its own
 * would pass. The elbow goes ahead of the shoulder (at half the weight it is three quarters bent), as an arm raised to
 * wave bends as it rises rather than swinging out straight first.
 */
function towards(bones: Bones, arm: "left" | "right", { upper, lower }: { readonly upper: readonly number[]; readonly lower: readonly number[] }, weight: number) {
  if (weight === 0) return;
  const mirror = arm === "left" ? [1, -1, -1] : [1, 1, 1];
  const move = (bone: GestureBone, to: readonly number[], share: number) => {
    const b = bones[bone];
    const goal = [0, 1, 2].map((i) => mirror[i] * to[i]);
    const turned = toEuler(slerp(toQuaternion(b), toQuaternion(goal), share), b.map((v, i) => v + (goal[i] - v) * share));
    b[0] = turned[0];
    b[1] = turned[1];
    b[2] = turned[2];
  };
  move(`${arm}UpperArm`, upper, weight);
  move(`${arm}LowerArm`, lower, weight * (2 - weight));
}

type Quaternion = [number, number, number, number];

/** A bone's angles (three's Euler order XYZ, as its normalized bones take them) as a quaternion [x, y, z, w], as three makes it. */
function toQuaternion([x, y, z]: readonly number[]): Quaternion {
  const [c1, c2, c3] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
  const [s1, s2, s3] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

/**
 * A quaternion back as angles in the order XYZ, as three's Euler reads one from its rotation matrix: of the two sets
 * of angles that turn a bone the same way, the one nearer `near`. An elbow bent by more than a quarter turn is the same
 * as one turned half a turn about x and z and bent by less, which is what three would read; the gesture's own angles,
 * which the beats and the wave add to, are the first.
 */
function toEuler([x, y, z, w]: Quaternion, near: readonly number[]): [number, number, number] {
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const turn = Math.asin(Math.min(1, Math.max(-1, m13)));
  const read: [number, number, number] = Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), turn, Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), turn, 0];
  const half = (angle: number) => angle - Math.sign(angle || 1) * Math.PI;
  const other: [number, number, number] = [half(read[0]), Math.sign(read[1] || 1) * Math.PI - read[1], half(read[2])];
  const off = (angles: readonly number[]) => angles.reduce((sum, angle, i) => sum + Math.abs(angle - near[i]), 0);
  return off(other) < off(read) ? other : read;
}

/** `share` of the way from `a` to `b` along the shortest turn between them. */
function slerp(a: Quaternion, b: Quaternion, share: number): Quaternion {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const to = cos < 0 ? (b.map((v) => -v) as Quaternion) : b;
  cos = Math.abs(cos);
  if (cos > 0.9995) {
    const mixed = a.map((v, i) => v + (to[i] - v) * share);
    const length = Math.hypot(...mixed);
    return mixed.map((v) => v / length) as Quaternion;
  }
  const angle = Math.acos(cos);
  const [ka, kb] = [Math.sin((1 - share) * angle) / Math.sin(angle), Math.sin(share * angle) / Math.sin(angle)];
  return a.map((v, i) => ka * v + kb * to[i]) as Quaternion;
}
