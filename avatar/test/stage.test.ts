import { test } from "node:test";
import assert from "node:assert/strict";
import { Color, Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { DEFAULT_SETTINGS, type ModelSettings } from "../src/model-settings.ts";
import { createMotion, type MotionInput } from "../src/motion.ts";
import { aim, COOL, framed, lighting, pose, rest, WARM } from "../src/stage.ts";
import { tinyVrm0, tinyVrm1 } from "./tiny-vrm.ts";

/**
 * Where the stage points the eyes (`aim`), measured on the eyes themselves: the tiny model read by three-vrm, as the
 * stage reads a model, with its eyes looking by their bones or by expressions, under the range maps pixiv's and
 * VirtualCast's samples have (a quarter turn to the target for the eyes' furthest: 10° of the bone, or the expression
 * at its full). And how it poses a model (`pose`), measured on where its bones are: the tiny VRM 1.0 model and its VRM
 * 0.x copy, which is the same model facing the other way in its own axes. And where the camera is and how the lights are
 * set for what is set on a model. No WebGL: nothing is drawn.
 */

const ranges = (outputScale: number) =>
  Object.fromEntries(["rangeMapHorizontalInner", "rangeMapHorizontalOuter", "rangeMapVerticalDown", "rangeMapVerticalUp"].map((name) => [name, { inputMaxValue: 90, outputScale }]));

async function read(bytes: Uint8Array<ArrayBuffer>): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const vrm = (await loader.parseAsync(bytes.buffer, "")).userData.vrm as VRM;
  // A VRM 0.x model turned to face the camera, as the stage turns it.
  VRMUtils.rotateVRM0(vrm);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  return vrm;
}

/** A camera 2.3 m in front of the model's eyes, as the bust's is, looking at them. */
function camera(vrm: VRM) {
  const eyes = vrm.lookAt!.getLookAtWorldPosition(new Vector3());
  const camera = new PerspectiveCamera(22, 1, 0.1, 20);
  camera.position.set(eyes.x, eyes.y, 2.3);
  camera.lookAt(eyes);
  camera.updateMatrixWorld(true);
  return camera;
}

/** The left eye bone's turn to the viewer's right and up, in degrees, after the eyes are aimed with `gaze`. */
async function boneEyes(gaze: [number, number]) {
  const vrm = await read(tinyVrm1((json) => Object.assign(json.extensions.VRMC_vrm.lookAt, ranges(10))));
  aim(vrm, camera(vrm), gaze);
  vrm.update(0);
  const turned = new Euler().setFromQuaternion(vrm.humanoid.getNormalizedBoneNode("leftEye")!.quaternion, "YXZ");
  return { right: MathUtils.radToDeg(turned.y), up: -MathUtils.radToDeg(turned.x) };
}

/** The look expressions' weights after the eyes are aimed with `gaze`, on a copy of the tiny model that looks by them. */
async function expressionEyes(gaze: [number, number]) {
  const vrm = await read(
    tinyVrm1((json) => {
      const own = json.extensions.VRMC_vrm;
      own.lookAt = { type: "expression", offsetFromHeadBone: [0, 0.06, 0], ...ranges(1) };
      for (const name of ["lookLeft", "lookRight", "lookUp", "lookDown"]) own.expressions.preset[name] = structuredClone(own.expressions.preset.aa);
    }),
  );
  aim(vrm, camera(vrm), gaze);
  vrm.update(0);
  const weight = (name: string) => vrm.expressionManager!.getValue(name)!;
  return { lookLeft: weight("lookLeft"), lookRight: weight("lookRight"), lookUp: weight("lookUp"), lookDown: weight("lookDown") };
}

const near = (value: number, expected: number, within: number, what: string) =>
  assert.ok(Math.abs(value - expected) <= within, `${what}: ${value}, not ${expected} ± ${within}`);

test("at the camera, the eyes look straight ahead", async () => {
  const bone = await boneEyes([0, 0]);
  near(bone.right, 0, 0.05, "the eye bone to the right");
  near(bone.up, 0, 0.05, "the eye bone up");
  for (const [name, weight] of Object.entries(await expressionEyes([0, 0]))) near(weight, 0, 0.005, name);
});

test("the gaze is a share of the eyes' own range: the thinking look turns an eye bone 7° aside and 5° up", async () => {
  const thinking = await boneEyes([0.7, 0.5]);
  near(thinking.right, 7, 0.1, "the eye bone to the viewer's right");
  near(thinking.up, 5, 0.1, "the eye bone up");
  // A saccade at its furthest, a fifth of the way, and looking down and to the viewer's left.
  const saccade = await boneEyes([-0.2, -0.2]);
  near(saccade.right, -2, 0.1, "the eye bone to the viewer's left");
  near(saccade.up, -2, 0.1, "the eye bone down");
});

test("on a model whose eyes look by expressions, the same gaze is the same share of each look", async () => {
  // To the viewer's right is the model's left.
  const thinking = await expressionEyes([0.7, 0.5]);
  near(thinking.lookLeft, 0.7, 0.01, "lookLeft");
  near(thinking.lookUp, 0.5, 0.01, "lookUp");
  assert.equal(thinking.lookRight, 0);
  assert.equal(thinking.lookDown, 0);
  const saccade = await expressionEyes([-0.2, -0.2]);
  near(saccade.lookRight, 0.2, 0.01, "lookRight");
  near(saccade.lookDown, 0.2, 0.01, "lookDown");
});

/** Where the bones that show a pose are, in the scene, and which way each eye looks there (a unit vector, +z at rest). */
type Seen = Record<string, Vector3>;
const SHOWN = ["head", "leftEye", "rightEye", "leftUpperArm", "rightUpperArm", "leftHand", "rightHand", "leftUpperLeg", "rightUpperLeg"] as const;

/**
 * A model read and at rest as the stage has it once loaded, with `settings` on it: what is seen of it, and a frame of it
 * (the motion's next step posed on it, the eyes aimed and the model updated, as the stage's frame does) and what is
 * seen then.
 */
async function posed(bytes: Uint8Array<ArrayBuffer>, settings: ModelSettings = DEFAULT_SETTINGS) {
  const vrm = await read(bytes);
  rest(vrm, settings);
  const eye = (name: "leftEye" | "rightEye") => vrm.humanoid.getRawBoneNode(name)!.getWorldQuaternion(new Quaternion());
  const fromRest = { leftEye: eye("leftEye").invert(), rightEye: eye("rightEye").invert() };
  const seen = (): Seen => {
    const seen: Seen = Object.fromEntries(SHOWN.map((name) => [name, vrm.humanoid.getRawBoneNode(name)!.getWorldPosition(new Vector3())]));
    for (const name of ["leftEye", "rightEye"] as const) seen[`${name} looks`] = new Vector3(0, 0, 1).applyQuaternion(eye(name).multiply(fromRest[name]));
    return seen;
  };
  const eyes = camera(vrm);
  const motion = createMotion(() => 0.5);
  const frame = (input: Omit<MotionInput, "settings">): Seen => {
    const moved = motion.step({ ...input, settings });
    pose(vrm, moved);
    aim(vrm, eyes, moved.gaze);
    vrm.update(input.dt);
    vrm.scene.updateMatrixWorld(true);
    return seen();
  };
  return { seen, frame };
}

/** `seconds` of frames at 30 a second in `mode`, and what is seen in the last. */
const run = (frame: (input: Omit<MotionInput, "settings">) => Seen, mode: MotionInput["mode"], seconds: number, output = 0) => {
  let seen!: Seen;
  for (let i = 0; i < 30 * seconds; i++) seen = frame({ mode, output, dt: 1 / 30, reduced: false });
  return seen;
};

const same = (zero: Seen, one: Seen, what: string) => {
  for (const [name, at] of Object.entries(one)) assert.ok(zero[name].distanceTo(at) < 1e-5, `${what}, ${name}: VRM 0.x at ${zero[name].toArray()}, VRM 1.0 at ${at.toArray()}`);
};

test("at rest the arms are down, on a VRM 0.x model as on a VRM 1.0 one: the hands below the shoulders, outside the hips", async () => {
  for (const [version, bytes] of [["VRM 1.0", tinyVrm1()], ["VRM 0.x", tinyVrm0()]] as const) {
    const seen = (await posed(bytes)).seen();
    // The model's left is the viewer's right, +x.
    for (const [side, outwards] of [["left", 1], ["right", -1]] as const) {
      const [hand, shoulder, hip] = [seen[`${side}Hand`], seen[`${side}UpperArm`], seen[`${side}UpperLeg`]];
      assert.ok(hand.y < shoulder.y - 0.3, `${version}: the ${side} hand at ${hand.y.toFixed(3)} m, the shoulder at ${shoulder.y.toFixed(3)} m`);
      assert.ok(outwards * hand.x > outwards * hip.x, `${version}: the ${side} hand ${hand.x.toFixed(3)} m across, the hip ${hip.x.toFixed(3)} m`);
    }
  }
});

test("leaning in moves the head towards the camera, on a VRM 0.x model as on a VRM 1.0 one", async () => {
  for (const [version, bytes] of [["VRM 1.0", tinyVrm1()], ["VRM 0.x", tinyVrm0()]] as const) {
    const { frame } = await posed(bytes);
    const before = run(frame, "idle", 1).head;
    const leaning = run(frame, "input", 2).head;
    assert.ok(leaning.z - before.z > 0.015, `${version}: the head from ${before.z.toFixed(3)} m to ${leaning.z.toFixed(3)} m towards the camera`);
  }
});

test("a VRM 0.x model is posed as a VRM 1.0 one is: its sway, lean, nod, thinking tilt and look the same on screen", async () => {
  const [zero, one] = [(await posed(tinyVrm0())).frame, (await posed(tinyVrm1())).frame];
  for (const [mode, seconds, output] of [["idle", 3, 0], ["input", 2, 0], ["output", 2, 0.8], ["thinking", 3, 0]] as const) {
    same(run(zero, mode, seconds, output), run(one, mode, seconds, output), mode);
  }
  // Thinking, the head turns and tilts and the eyes look aside to the viewer's right and up, as on a VRM 1.0 model.
  const thinking = run(zero, "thinking", 1);
  assert.ok(thinking["leftEye looks"].x > 0.1 && thinking["leftEye looks"].y > 0.05, `the left eye looks along ${thinking["leftEye looks"].toArray()}`);
  // Its top to the viewer's left: the eye on the viewer's right, the model's left, higher.
  assert.ok(thinking.leftEye.y - thinking.rightEye.y > 0.005, `the left eye ${thinking.leftEye.y.toFixed(4)} m high, the right ${thinking.rightEye.y.toFixed(4)} m`);
});

test("at a smaller arm angle the hands are higher, still outside the hips, on a VRM 0.x model as on a VRM 1.0 one", async () => {
  const raised = { ...DEFAULT_SETTINGS, armDown: 1 };
  for (const [version, bytes] of [["VRM 1.0", tinyVrm1], ["VRM 0.x", tinyVrm0]] as const) {
    const [usual, set] = [(await posed(bytes())).seen(), (await posed(bytes(), raised)).seen()];
    for (const [side, outwards] of [["left", 1], ["right", -1]] as const) {
      const [hand, hip] = [set[`${side}Hand`], set[`${side}UpperLeg`]];
      // The tiny model's arm is 0.5 m long: 0.2 rad less is 4 cm higher at the hand.
      assert.ok(hand.y > usual[`${side}Hand`].y + 0.03, `${version}: the ${side} hand at ${hand.y.toFixed(3)} m, at the usual angle ${usual[`${side}Hand`].y.toFixed(3)} m`);
      assert.ok(outwards * hand.x > outwards * hip.x, `${version}: the ${side} hand ${hand.x.toFixed(3)} m across, the hip ${hip.x.toFixed(3)} m`);
    }
  }
  same((await posed(tinyVrm0(), raised)).seen(), (await posed(tinyVrm1(), raised)).seen(), "at rest");
});

test("the camera is where it was at the defaults, nearer by the zoom, and lower by the height in both framings", () => {
  const at = (kind: "bust" | "face", set: Partial<ModelSettings> = {}) => framed(kind, 1.4, { ...DEFAULT_SETTINGS, ...set });
  const bust = at("bust");
  near(bust.y, 1.35, 1e-9, "the bust's camera height");
  near(bust.z, (1.6 * 10) / 7, 1e-9, "the bust's distance");
  near(bust.at, 1.28, 1e-9, "where the bust's camera looks");
  assert.deepEqual(at("face"), { y: 1.42, z: 0.75, at: 1.42 });
  for (const kind of ["bust", "face"] as const) {
    const usual = at(kind);
    near(at(kind, { zoom: 2 }).z, usual.z / 2, 1e-9, `${kind} at a zoom of 2`);
    const higher = at(kind, { height: 0.05 });
    near(higher.y, usual.y - 0.05, 1e-9, `${kind}: the camera, 5 cm higher`);
    near(higher.at, usual.at - 0.05, 1e-9, `${kind}: what it looks at, 5 cm higher`);
    assert.equal(higher.z, usual.z);
  }
});

test("the lights are white at their usual strength at the defaults, stronger with the brightness, and tinted by the warmth", () => {
  const set = (given: Partial<ModelSettings>) => lighting({ ...DEFAULT_SETTINGS, ...given });
  assert.deepEqual(set({}), { color: [1, 1, 1], sun: Math.PI, ambient: 0.4 });
  const bright = set({ brightness: 1.5 });
  near(bright.sun, 1.5 * Math.PI, 1e-9, "the sun");
  near(bright.ambient, 0.6, 1e-9, "all round");
  const colour = (hex: number) => new Color(hex).toArray() as number[];
  set({ warmth: 1 }).color.forEach((c, i) => near(c, colour(WARM)[i], 1e-9, `warm, channel ${i}`));
  set({ warmth: -1 }).color.forEach((c, i) => near(c, colour(COOL)[i], 1e-9, `cool, channel ${i}`));
  set({ warmth: 0.5 }).color.forEach((c, i) => near(c, (1 + colour(WARM)[i]) / 2, 1e-9, `halfway, channel ${i}`));
  set({ warmth: -0.5 }).color.forEach((c, i) => near(c, (1 + colour(COOL)[i]) / 2, 1e-9, `halfway, channel ${i}`));
});
