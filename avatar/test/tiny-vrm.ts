/**
 * Two VRM models made in code, so the tests need no model file in the repository: the 15 bones three-vrm needs plus
 * chest, neck and the eyes, one triangle in front of the head with a morph target that the mouth's five shapes (`aa`,
 * `ih`, `ou`, `ee`, `oh`) and the blink are bound to, a meta with a licence, and the eyes looking by their bones.
 * `tinyVrm1` is VRM 1.0 (`VRMC_vrm`), `tinyVrm0` the same as VRM 0.x (`VRM`). Each takes a change to its glTF JSON, for
 * a test of a damaged copy.
 */

type Json = Record<string, any>;

/** Each bone: its name, where it is from its parent, and its parent. */
const BONES: [string, [number, number, number], string | null][] = [
  ["hips", [0, 0.9, 0], null], ["spine", [0, 0.1, 0], "hips"], ["chest", [0, 0.15, 0], "spine"], ["neck", [0, 0.2, 0], "chest"], ["head", [0, 0.1, 0], "neck"],
  ["leftEye", [0.03, 0.06, 0.05], "head"], ["rightEye", [-0.03, 0.06, 0.05], "head"],
  ["leftUpperArm", [0.15, 0.15, 0], "chest"], ["leftLowerArm", [0.25, 0, 0], "leftUpperArm"], ["leftHand", [0.25, 0, 0], "leftLowerArm"],
  ["rightUpperArm", [-0.15, 0.15, 0], "chest"], ["rightLowerArm", [-0.25, 0, 0], "rightUpperArm"], ["rightHand", [-0.25, 0, 0], "rightLowerArm"],
  ["leftUpperLeg", [0.08, -0.05, 0], "hips"], ["leftLowerLeg", [0, -0.4, 0], "leftUpperLeg"], ["leftFoot", [0, -0.4, 0], "leftLowerLeg"],
  ["rightUpperLeg", [-0.08, -0.05, 0], "hips"], ["rightLowerLeg", [0, -0.4, 0], "rightUpperLeg"], ["rightFoot", [0, -0.4, 0], "rightLowerLeg"],
];
/** The triangle's node, after the bones. */
const FACE = BONES.length;

/**
 * The triangle and its morph target, as the binary chunk holds them, in front of the face: a VRM 1.0 model faces +z, a
 * VRM 0.x one -z (three-vrm turns it round), so the triangle is mirrored for it, as the whole model is.
 */
function triangle(facing: 1 | -1): Uint8Array {
  const position = new Float32Array([0, 1.4, 0.1, 0.1, 1.4, 0.1, 0, 1.5, 0.1].map((v, i) => (i % 3 === 1 ? v : v * facing)));
  const morph = new Float32Array([0, -0.05, 0, 0, -0.05, 0, 0, 0, 0]);
  const bin = new Uint8Array(position.byteLength + morph.byteLength);
  bin.set(new Uint8Array(position.buffer), 0);
  bin.set(new Uint8Array(morph.buffer), position.byteLength);
  return bin;
}

/** What both versions share: the nodes, the triangle, its accessors; mirrored for a model that faces -z. */
function gltf(extension: string, facing: 1 | -1): Json {
  const nodes: Json[] = BONES.map(([name, [x, y, z]]) => ({ name, translation: [x * facing, y, z * facing] }));
  BONES.forEach(([, , parent], i) => {
    if (parent) (nodes[BONES.findIndex(([n]) => n === parent)].children ??= []).push(i);
  });
  nodes.push({ name: "face", mesh: 0 });
  const [x, , z] = [0.1 * facing, 0, 0.1 * facing];
  return {
    asset: { version: "2.0", generator: "pithagoras-flair tests" },
    extensionsUsed: [extension],
    scene: 0,
    scenes: [{ nodes: [0, FACE] }],
    nodes,
    buffers: [{ byteLength: 72 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [Math.min(0, x), 1.4, z], max: [Math.max(0, x), 1.5, z] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3", min: [0, -0.05, 0], max: [0, 0, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }] }], weights: [0], extras: { targetNames: ["mouth"] } }],
  };
}

/** The glTF JSON of the VRM 1.0 model. */
export function vrm1Json(): Json {
  const json = gltf("VRMC_vrm", 1);
  const bind = { morphTargetBinds: [{ node: FACE, index: 0, weight: 1 }] };
  json.extensions = {
    VRMC_vrm: {
      specVersion: "1.0",
      meta: {
        name: "Tiny",
        authors: ["Pithagoras Flair tests"],
        licenseUrl: "https://vrm.dev/licenses/1.0/",
        avatarPermission: "everyone",
        commercialUsage: "corporation",
        creditNotation: "unnecessary",
        allowRedistribution: true,
        modification: "allowModificationRedistribution",
      },
      humanoid: { humanBones: Object.fromEntries(BONES.map(([name], node) => [name, { node }])) },
      expressions: { preset: { aa: bind, ih: bind, ou: bind, ee: bind, oh: bind, blink: bind } },
      lookAt: { type: "bone", offsetFromHeadBone: [0, 0.06, 0] },
    },
  };
  return json;
}

/** The glTF JSON of the VRM 0.x model. */
export function vrm0Json(): Json {
  const json = gltf("VRM", -1);
  const binds = [{ mesh: 0, index: 0, weight: 100 }];
  json.extensions = {
    VRM: {
      specVersion: "0.0",
      meta: { title: "Tiny Zero", author: "Pithagoras Flair tests", licenseName: "CC0", allowedUserName: "Everyone", commercialUssageName: "Allow" },
      humanoid: { humanBones: BONES.map(([bone], node) => ({ bone, node })) },
      blendShapeMaster: {
        blendShapeGroups: [...["a", "i", "u", "e", "o"].map((vowel) => ({ name: vowel.toUpperCase(), presetName: vowel, binds })), { name: "Blink", presetName: "blink", binds }],
      },
      // Its eyes looking by their bones, over the ranges a VRM 1.0 model has when it gives none, on the straight curve
      // (three-vrm warns of any other).
      firstPerson: {
        firstPersonBoneOffset: { x: 0, y: 0.06, z: 0 },
        lookAtTypeName: "Bone",
        ...Object.fromEntries(
          ["lookAtHorizontalInner", "lookAtHorizontalOuter", "lookAtVerticalDown", "lookAtVerticalUp"].map((name) => [name, { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 }]),
        ),
      },
    },
  };
  return json;
}

/** A GLB of `json` and the triangle. */
export const glb = (json: Json): Uint8Array<ArrayBuffer> => glbOf(json, triangle(json.extensionsUsed?.includes("VRM") ? -1 : 1));

/** A GLB of `json` and `bin`: its header, the JSON chunk padded with spaces, the binary chunk (a multiple of 4 bytes). */
export function glbOf(json: Json, bin: Uint8Array): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.byteLength / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, bin.byteLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

export const tinyVrm1 = (change?: (json: Json) => void) => {
  const json = vrm1Json();
  change?.(json);
  return glb(json);
};

export const tinyVrm0 = (change?: (json: Json) => void) => {
  const json = vrm0Json();
  change?.(json);
  return glb(json);
};
