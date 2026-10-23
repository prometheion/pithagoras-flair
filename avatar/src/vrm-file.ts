import type { ModelSpec, Vrm0Licence, Vrm1Licence } from "./model";

/**
 * Whether an uploaded file is a VRM model this extension can draw, read from its first bytes: the GLB header and the
 * JSON chunk after it. The binary chunk is not parsed: a file that passes can still fail to draw, which the Settings
 * page's preview shows, and voice mode then draws the orb. Pure, for the server half and its tests.
 */

/** Why a file is refused: `code` is what the page says it in its own words by, `detail` what it names. */
export class Refused extends Error {
  constructor(
    readonly code: "not-glb" | "not-vrm" | "missing-bone" | "compressed",
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** The 15 bones three-vrm needs (its `VRMRequiredHumanBoneName`): it throws while it loads a model without one. */
export const REQUIRED_BONES = [
  "hips", "spine", "head",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
  "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand",
] as const;

/** What the bundled GLTFLoader cannot read without decoders this package does not ship. */
export const COMPRESSIONS = ["KHR_draco_mesh_compression", "KHR_texture_basisu", "EXT_meshopt_compression"] as const;

/** The longest name a model is given, in characters. */
export const NAME_MAX = 80;

/** "glTF" and "JSON", as a GLB's header and its first chunk's type say them (little-endian). */
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const listed = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * What the file is, from `read(position, length)` (that many bytes of it from that place) and its `size`: the VRM
 * version it is made in, the name it gives itself and what it says of its licence. Throws a `Refused`, checked in
 * this order: a GLB of glTF 2 whose header says its length (`not-glb`), with a JSON chunk first that lies inside it
 * and parses (`not-glb`), that is a VRM 1.0 or 0.x model (`not-vrm`) with every bone three-vrm needs
 * (`missing-bone`), and needs none of the compressions it cannot read (`compressed`).
 */
export function checkVrm(read: (position: number, length: number) => Uint8Array, size: number): ModelSpec & { name?: string } {
  if (size < 20) throw new Refused("not-glb", "The file is too short to be a GLB");
  const head = read(0, 20);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Refused("not-glb", "The file is not a GLB");
  if (view.getUint32(4, true) !== 2) throw new Refused("not-glb", "The GLB is not of glTF 2");
  if (view.getUint32(8, true) !== size) throw new Refused("not-glb", "The GLB's header gives another length than the file has");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + length > size) throw new Refused("not-glb", "The GLB has no JSON chunk first");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(read(20, length)));
  } catch {
    throw new Refused("not-glb", "The GLB's JSON does not parse");
  }
  if (!isObject(json)) throw new Refused("not-glb", "The GLB's JSON is not an object");

  const used = listed(json.extensionsUsed);
  const extensions = isObject(json.extensions) ? json.extensions : {};
  const vrm1 = used.includes("VRMC_vrm") && isObject(extensions.VRMC_vrm) ? extensions.VRMC_vrm : undefined;
  const vrm0 = used.includes("VRM") && isObject(extensions.VRM) ? extensions.VRM : undefined;
  const bones1 = vrm1 && isObject(vrm1.humanoid) ? vrm1.humanoid.humanBones : undefined;
  const bones0 = vrm0 && isObject(vrm0.humanoid) ? vrm0.humanoid.humanBones : undefined;
  let has: (bone: string) => boolean;
  if (isObject(bones1)) has = (bone) => isObject(bones1[bone]) && typeof bones1[bone].node === "number";
  else if (Array.isArray(bones0)) has = (bone) => bones0.some((b) => isObject(b) && b.bone === bone && typeof b.node === "number");
  else throw new Refused("not-vrm", "The file is a glTF model, not a VRM one");
  const missing = REQUIRED_BONES.find((bone) => !has(bone));
  if (missing) throw new Refused("missing-bone", `The model has no ${missing} bone, which an avatar needs`, missing);

  const required = listed(json.extensionsRequired);
  const compressed = COMPRESSIONS.find((name) => required.includes(name));
  if (compressed) throw new Refused("compressed", `The model is compressed in a way this extension cannot read (${compressed})`, compressed);

  if (isObject(bones1)) {
    const meta = isObject(vrm1!.meta) ? vrm1!.meta : {};
    return { spec: "1.0", name: text(meta.name), licence: licence1(meta) };
  }
  const meta = isObject(vrm0!.meta) ? vrm0!.meta : {};
  return { spec: "0.x", name: text(meta.title), licence: licence0(meta) };
}

/** A model's name: its own where it gives one, else the uploaded file's name without `.vrm`, else "Model"; at most NAME_MAX characters. */
export function modelName(own: string | undefined, fileName: string | undefined): string {
  const name = own ?? text(fileName?.replace(/\.vrm$/i, "")) ?? "Model";
  return [...name].slice(0, NAME_MAX).join("").trim();
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** An address to show as a link: http and https only. */
const link = (v: unknown) => {
  const given = text(v);
  if (!given) return undefined;
  try {
    return ["http:", "https:"].includes(new URL(given).protocol) ? given : undefined;
  } catch {
    return undefined;
  }
};
const oneOf = <T extends string>(set: readonly T[], v: unknown): T | undefined => (set.includes(v as T) ? (v as T) : undefined);
/** Without the fields that are not given, so a summary has only what the model says. */
const given = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function licence1(meta: Json): Vrm1Licence {
  const authors = listed(meta.authors).map(text).filter((a): a is string => a !== undefined);
  return given({
    authors: authors.length ? authors : undefined,
    licenseUrl: link(meta.licenseUrl),
    avatarPermission: oneOf(["onlyAuthor", "onlySeparatelyLicensedPerson", "everyone"] as const, meta.avatarPermission),
    commercialUsage: oneOf(["personalNonProfit", "personalProfit", "corporation"] as const, meta.commercialUsage),
    creditNotation: oneOf(["required", "unnecessary"] as const, meta.creditNotation),
    allowRedistribution: typeof meta.allowRedistribution === "boolean" ? meta.allowRedistribution : undefined,
    otherLicenseUrl: link(meta.otherLicenseUrl),
  });
}

function licence0(meta: Json): Vrm0Licence {
  return given({
    author: text(meta.author),
    licenseName: oneOf(["Redistribution_Prohibited", "CC0", "CC_BY", "CC_BY_NC", "CC_BY_SA", "CC_BY_NC_SA", "CC_BY_ND", "CC_BY_NC_ND", "Other"] as const, meta.licenseName),
    allowedUserName: oneOf(["OnlyAuthor", "ExplicitlyLicensedPerson", "Everyone"] as const, meta.allowedUserName),
    commercialUssageName: oneOf(["Disallow", "Allow"] as const, meta.commercialUssageName),
    otherLicenseUrl: link(meta.otherLicenseUrl),
    otherPermissionUrl: link(meta.otherPermissionUrl),
  });
}
