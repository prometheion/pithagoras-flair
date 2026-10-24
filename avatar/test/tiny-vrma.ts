import { glbOf } from "./tiny-vrm.ts";

/**
 * A VRM Animation made in code, so the tests need no clip file in the repository: a T-posed humanoid of the hips, the
 * spine and the right arm, and one second in which the right upper arm turns from down at the side (1.2 rad about z,
 * as the avatar holds it) up past level (-0.6 rad), and the hips turn 0.3 rad about y. Takes a change to its glTF JSON,
 * for a test of a damaged copy or of the clip on another bone, and the arm's turn at its start and its end.
 */

type Json = Record<string, any>;

/** Each bone: its name, where it is from its parent, and its parent's index. */
const BONES: [string, [number, number, number], number | null][] = [
  ["hips", [0, 0.9, 0], null],
  ["spine", [0, 0.1, 0], 0],
  ["rightUpperArm", [-0.15, 0.3, 0], 1],
];

/** A turn of `angle` about the unit `axis`, as a quaternion [x, y, z, w]. */
const turn = ([x, y, z]: [number, number, number], angle: number) => [x * Math.sin(angle / 2), y * Math.sin(angle / 2), z * Math.sin(angle / 2), Math.cos(angle / 2)];
export const ARM_FROM = 1.2;
export const ARM_TO = -0.6;
export const HIPS_TO = 0.3;

export function vrmaJson(): Json {
  const nodes: Json[] = BONES.map(([name, translation]) => ({ name, translation }));
  BONES.forEach(([, , parent], i) => {
    if (parent !== null) (nodes[parent].children ??= []).push(i);
  });
  return {
    asset: { version: "2.0", generator: "pithagoras-flair tests" },
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: { VRMC_vrm_animation: { specVersion: "1.0", humanoid: { humanBones: Object.fromEntries(BONES.map(([name], node) => [name, { node }])) } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    buffers: [{ byteLength: 72 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 32 }, { buffer: 0, byteOffset: 40, byteLength: 32 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 1, componentType: 5126, count: 2, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC4" },
    ],
    animations: [
      {
        channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }, { sampler: 1, target: { node: 0, path: "rotation" } }],
        samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }, { input: 0, output: 2, interpolation: "LINEAR" }],
      },
    ],
  };
}

export function tinyVrma(change?: (json: Json) => void, [from, to] = [ARM_FROM, ARM_TO]): Uint8Array<ArrayBuffer> {
  const json = vrmaJson();
  change?.(json);
  const values = new Float32Array([0, 1, ...turn([0, 0, 1], from), ...turn([0, 0, 1], to), ...turn([0, 1, 0], 0), ...turn([0, 1, 0], HIPS_TO)]);
  return glbOf(json, new Uint8Array(values.buffer));
}
