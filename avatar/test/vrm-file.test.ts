import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVrm, checkVrma, COMPRESSIONS, modelName, Refused, REQUIRED_BONES } from "../src/vrm-file.ts";
import { glb, tinyVrm0, tinyVrm1, vrm1Json } from "./tiny-vrm.ts";
import { tinyVrma } from "./tiny-vrma.ts";

/** What an upload is checked for before it is kept, and what is kept of a model's meta: its name and its licence. */

const check = (bytes: Uint8Array) => checkVrm((position, length) => bytes.subarray(position, position + length), bytes.byteLength);
/** The code a refusal says, and what it names. */
const refused = (bytes: Uint8Array) => {
  try {
    check(bytes);
  } catch (e) {
    assert.ok(e instanceof Refused, `refused as Refused, not ${e}`);
    return [e.code, e.detail];
  }
  assert.fail("taken");
};
/** A copy of the VRM 1.0 model with its header changed at `offset`. */
const header = (offset: number, value: number) => {
  const bytes = tinyVrm1();
  new DataView(bytes.buffer).setUint32(offset, value, true);
  return bytes;
};

test("both tiny models are taken, with their version, their own name and their licence", () => {
  assert.deepEqual(check(tinyVrm1()), {
    spec: "1.0",
    name: "Tiny",
    licence: {
      authors: ["Pithagoras Flair tests"],
      licenseUrl: "https://vrm.dev/licenses/1.0/",
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      creditNotation: "unnecessary",
      allowRedistribution: true,
    },
  });
  assert.deepEqual(check(tinyVrm0()), {
    spec: "0.x",
    name: "Tiny Zero",
    licence: { author: "Pithagoras Flair tests", licenseName: "CC0", allowedUserName: "Everyone", commercialUssageName: "Allow" },
  });
});

test("a file that is not a GLB of glTF 2 with its JSON first is not-glb", () => {
  assert.deepEqual(refused(new Uint8Array(12)), ["not-glb", undefined]);
  assert.deepEqual(refused(header(0, 0x12345678)), ["not-glb", undefined], "another magic");
  assert.deepEqual(refused(header(4, 1)), ["not-glb", undefined], "version 1");
  const length = tinyVrm1().byteLength;
  assert.deepEqual(refused(header(8, length + 4)), ["not-glb", undefined], "a header that says another length");
  assert.deepEqual(refused(tinyVrm1().subarray(0, length - 4)), ["not-glb", undefined], "cut short");
  assert.deepEqual(refused(header(16, 0x004e4942)), ["not-glb", undefined], "a binary chunk first");
  assert.deepEqual(refused(header(12, length)), ["not-glb", undefined], "a JSON chunk that runs past the end");
  const broken = tinyVrm1();
  broken[20] = 0x7b;
  broken[21] = 0x7b;
  assert.deepEqual(refused(broken), ["not-glb", undefined], "JSON that does not parse");
  const listed = glb([] as never);
  assert.deepEqual(refused(listed), ["not-glb", undefined], "JSON that is not an object");
});

test("a glTF model that is not a VRM one is not-vrm", () => {
  assert.deepEqual(refused(tinyVrm1((json) => (json.extensionsUsed = []))), ["not-vrm", undefined], "the extension not said to be used");
  assert.deepEqual(refused(tinyVrm1((json) => delete json.extensions)), ["not-vrm", undefined]);
  assert.deepEqual(refused(tinyVrm1((json) => (json.extensions.VRMC_vrm.humanoid.humanBones = []))), ["not-vrm", undefined], "VRM 1.0's bones are an object");
  assert.deepEqual(refused(tinyVrm0((json) => (json.extensions.VRM.humanoid.humanBones = {}))), ["not-vrm", undefined], "VRM 0.x's are a list");
});

test("a model without one of the 15 bones three-vrm needs is missing-bone, naming it", () => {
  assert.equal(REQUIRED_BONES.length, 15);
  for (const bone of REQUIRED_BONES) {
    assert.deepEqual(refused(tinyVrm1((json) => delete json.extensions.VRMC_vrm.humanoid.humanBones[bone])), ["missing-bone", bone]);
    assert.deepEqual(
      refused(tinyVrm0((json) => (json.extensions.VRM.humanoid.humanBones = json.extensions.VRM.humanoid.humanBones.filter((b: { bone: string }) => b.bone !== bone)))),
      ["missing-bone", bone],
    );
  }
  // Optional ones are not needed.
  assert.equal(check(tinyVrm1((json) => delete json.extensions.VRMC_vrm.humanoid.humanBones.chest)).spec, "1.0");
});

test("a model that needs a compression the loader cannot read is compressed, naming it", () => {
  for (const name of COMPRESSIONS) {
    assert.deepEqual(refused(tinyVrm1((json) => (json.extensionsRequired = [name]))), ["compressed", name]);
  }
  // Used with a fallback, it is read without it.
  assert.equal(check(tinyVrm1((json) => json.extensionsUsed.push("EXT_meshopt_compression"))).spec, "1.0");
});

test("a model that loads a buffer or a picture from an address of its own, outside or beside the portal, is external", () => {
  const beacon = "https://tracker.example.invalid/beacon.png?who=me";
  const cases: [string, (json: Record<string, any>) => void][] = [
    ["a buffer outside", (json) => json.buffers.push({ uri: "https://tracker.example.invalid/body.bin", byteLength: 36 })],
    ["a buffer beside the portal", (json) => json.buffers.push({ uri: "body.bin", byteLength: 36 })],
    ["the GLB's own buffer given an address", (json) => (json.buffers[0].uri = "https://tracker.example.invalid/body.bin")],
    ["a picture outside", (json) => (json.images = [{ uri: beacon }])],
    ["a picture beside the portal", (json) => (json.images = [{ uri: "../../../api/sessions" }])],
    ["a picture in the address itself", (json) => (json.images = [{ uri: "data:image/png;base64,iVBORw0KGgo=" }])],
  ];
  for (const [what, change] of cases) {
    assert.deepEqual(refused(tinyVrm1(change)), ["external", undefined], what);
    assert.deepEqual(refused(tinyVrm0(change)), ["external", undefined], `${what}, VRM 0.x`);
  }
  // A picture in the file's own binary chunk, as exporters put them.
  assert.equal(check(tinyVrm1((json) => (json.images = [{ bufferView: 0, mimeType: "image/png" }]))).spec, "1.0");
});

test("only the licence fields and values the VRM specifications give are kept, and links only to http and https", () => {
  const odd = check(
    tinyVrm1((json) => {
      Object.assign(json.extensions.VRMC_vrm.meta, {
        authors: ["  Ada ", "", 7],
        licenseUrl: "javascript:alert(1)",
        avatarPermission: "anyone",
        commercialUsage: "Corporation",
        creditNotation: true,
        allowRedistribution: "yes",
        otherLicenseUrl: "http://example.test/terms",
        contactInformation: "ada@example.test",
      });
    }),
  );
  assert.deepEqual(odd.licence, { authors: ["Ada"], otherLicenseUrl: "http://example.test/terms" });
  const zero = check(
    tinyVrm0((json) => {
      Object.assign(json.extensions.VRM.meta, { licenseName: "MIT", allowedUserName: "everyone", commercialUssageName: "Allow", otherPermissionUrl: "data:text/html,hi", otherLicenseUrl: "https://example.test/" });
    }),
  );
  assert.deepEqual(zero.licence, { author: "Pithagoras Flair tests", commercialUssageName: "Allow", otherLicenseUrl: "https://example.test/" });
  assert.deepEqual(check(tinyVrm1((json) => (json.extensions.VRMC_vrm.meta = "none"))).licence, {}, "a meta that is not an object says nothing");
});

test("a model is named by its own name, else the file's without .vrm, else Model, at most 80 characters", () => {
  assert.equal(modelName("Alicia", "a.vrm"), "Alicia");
  assert.equal(modelName(undefined, "Seed-san.VRM"), "Seed-san");
  assert.equal(modelName(undefined, ".vrm"), "Model");
  assert.equal(modelName(undefined, undefined), "Model");
  assert.equal(modelName("é".repeat(100), undefined), "é".repeat(80));
  assert.equal(check(tinyVrm1((json) => (json.extensions.VRMC_vrm.meta.name = "  "))).name, undefined, "a blank name is none");
  assert.equal(vrm1Json().extensions.VRMC_vrm.meta.name, "Tiny");
});

// A gesture clip.

const clip = (bytes: Uint8Array) => {
  try {
    checkVrma((position, length) => bytes.subarray(position, position + length), bytes.byteLength);
  } catch (e) {
    assert.ok(e instanceof Refused, `refused as Refused, not ${e}`);
    return e.code;
  }
  return "taken";
};

test("a VRM Animation is taken as a clip; a model, a GLB that is not one or one that loads from outside its file is not", () => {
  assert.equal(clip(tinyVrma()), "taken");
  assert.equal(clip(new Uint8Array(12)), "not-glb");
  const cut = tinyVrma();
  assert.equal(clip(cut.subarray(0, cut.byteLength - 4)), "not-glb", "cut short");
  assert.equal(clip(tinyVrm1()), "not-vrma", "a model");
  assert.equal(clip(tinyVrma((json) => (json.extensionsUsed = []))), "not-vrma", "not said to be one");
  assert.equal(clip(tinyVrma((json) => delete json.extensions.VRMC_vrm_animation.humanoid)), "not-vrma", "no bones");
  assert.equal(clip(tinyVrma((json) => (json.animations = []))), "not-vrma", "no animation");
  assert.equal(clip(tinyVrma((json) => (json.buffers[0].uri = "https://example.com/motion.bin"))), "external");
  assert.equal(clip(tinyVrma((json) => (json.images = [{ uri: "/api/whatever.png" }]))), "external");
});
