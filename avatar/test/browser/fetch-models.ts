import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The sample models the browser tests draw, and a sample VRM Animation they play, fetched into test/.models/ (not kept
 * in git) from the commits they are pinned to, and checked by their size and sha256. None is in this repository. The
 * models are under the VRM Public License 1.0 (https://vrm.dev/licenses/1.0/), which allows passing them on: pixiv's
 * needs no credit; Seed-san's does ("Seed-san model by VirtualCast, Inc."), so no picture of it is kept. The animation
 * is three-vrm-animation's own example (an arm raised, a smile and a look), in pixiv's three-vrm repository under its
 * MIT License. A run without the network skips the tests that need them, and says so.
 */
export const MODELS = {
  twist: {
    file: "VRM1_Constraint_Twist_Sample.vrm",
    url: "https://raw.githubusercontent.com/pixiv/three-vrm/5a3242b66124386c32b085c6693d9059040e72e5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
    size: 10776032,
    sha256: "12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2",
  },
  seed: {
    file: "Seed-san.vrm",
    url: "https://raw.githubusercontent.com/vrm-c/vrm-specification/837f156dbce43ad69183ce1bdab549961ae1c1ee/samples/Seed-san/vrm/Seed-san.vrm",
    size: 10917800,
    sha256: "624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23",
  },
  clip: {
    file: "test.vrma",
    url: "https://raw.githubusercontent.com/pixiv/three-vrm/63dd83ce7834b4b8ffaedda71c7d8e5fffa421dd/packages/three-vrm-animation/examples/models/test.vrma",
    size: 11548,
    sha256: "38d0fd12d61e896f1a970b5e358ebb41a96c8d5ee8e284496ea18f0ba1f04e7b",
  },
};

export const MODELS_DIR = path.resolve(import.meta.dirname, "../.models");
/** Where a sample is once fetched and checked, or undefined. */
export const sample = (name: keyof typeof MODELS) => {
  const file = path.join(MODELS_DIR, MODELS[name].file);
  return existsSync(file) ? file : undefined;
};

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export default async function fetchModels() {
  mkdirSync(MODELS_DIR, { recursive: true });
  for (const { file, url, size, sha256: expected } of Object.values(MODELS)) {
    const at = path.join(MODELS_DIR, file);
    if (existsSync(at) && sha256(readFileSync(at)) === expected) continue;
    try {
      const answer = await fetch(url);
      if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
      const bytes = Buffer.from(await answer.arrayBuffer());
      if (bytes.length !== size || sha256(bytes) !== expected) throw new Error(`got ${bytes.length} bytes, sha256 ${sha256(bytes)}`);
      writeFileSync(at, bytes);
    } catch (e) {
      console.log(`${file} could not be fetched (${(e as Error).message}): the tests that draw it are skipped`);
    }
  }
}
