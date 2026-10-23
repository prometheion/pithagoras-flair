import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, MathUtils, PerspectiveCamera, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import { aim } from "../src/stage.ts";
import { tinyVrm1 } from "./tiny-vrm.ts";

/**
 * Where the stage points the eyes (`aim`), measured on the eyes themselves: the tiny model read by three-vrm, as the
 * stage reads a model, with its eyes looking by their bones or by expressions, under the range maps pixiv's and
 * VirtualCast's samples have (a quarter turn to the target for the eyes' furthest: 10° of the bone, or the expression
 * at its full). No WebGL: nothing is drawn.
 */

const ranges = (outputScale: number) =>
  Object.fromEntries(["rangeMapHorizontalInner", "rangeMapHorizontalOuter", "rangeMapVerticalDown", "rangeMapVerticalUp"].map((name) => [name, { inputMaxValue: 90, outputScale }]));

async function read(bytes: Uint8Array<ArrayBuffer>): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const vrm = (await loader.parseAsync(bytes.buffer, "")).userData.vrm as VRM;
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
