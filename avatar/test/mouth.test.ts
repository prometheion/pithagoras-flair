import { test } from "node:test";
import assert from "node:assert/strict";
import { createMouth, VISEMES, type MouthShapes, type Viseme } from "../src/mouth.ts";

/** The mouth's shapes from the reply's loudness alone, step by step: one vowel to a syllable, chosen by how it starts. */

/** The same numbers every run: a small linear congruential generator. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** The shape the mouth mostly has: the vowel with the largest share once the jaw's own aa is taken off. */
const dominant = (shapes: MouthShapes): Viseme => {
  const open = Math.max(...VISEMES.map((v) => shapes[v]));
  return VISEMES.filter((v) => v !== "aa").find((v) => shapes[v] > 0.5 * open && shapes[v] >= shapes.aa - 0.25 * open) ?? "aa";
};

/**
 * Runs a mouth for `seconds` at `fps` on the loudness `level(t)`, and gives for each syllable (from the step it rose
 * over 0.3 to the step it fell under it) the vowel its mouth had at its loudest, and every step's shapes.
 */
function speak(level: (t: number) => number, seconds: number, { fps = 60, seed = 1, shapes = true } = {}) {
  const mouth = createMouth(seeded(seed));
  const steps: { t: number; level: number; shapes: MouthShapes }[] = [];
  for (let i = 1; i <= seconds * fps; i++) {
    const t = i / fps;
    steps.push({ t, level: level(t), shapes: mouth.step({ speaking: true, output: level(t), dt: 1 / fps, sensitivity: 1, shapes }).expressions });
  }
  const syllables: { vowels: Viseme[]; loudest: Viseme }[] = [];
  let current: (typeof steps)[number][] | undefined;
  for (const step of steps) {
    if (step.level > 0.3) (current ??= []).push(step);
    else if (current) {
      const loudest = current.reduce((a, b) => (b.level > a.level ? b : a));
      // The steps after the first 80 ms: the shape eases in from the one before.
      syllables.push({ vowels: current.filter((s) => s.t - current![0].t >= 0.08).map((s) => dominant(s.shapes)), loudest: dominant(loudest.shapes) });
      current = undefined;
    }
  }
  return { steps, syllables };
}

/** Syllables four a second, each rising and falling, louder and softer over slower phrases: as the portal's made-up voice. */
const voice = (t: number) => Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * (0.6 + 0.35 * Math.sin(1.3 * t));

test("each syllable takes one vowel's shape and keeps it, and the syllables go through all five", () => {
  const { syllables } = speak(voice, 30);
  assert.ok(syllables.length > 80, `${syllables.length} syllables`);
  for (const { vowels } of syllables) assert.ok(new Set(vowels).size <= 1, `one shape in a syllable, not ${vowels.join(" ")}`);
  const counts = Object.fromEntries(VISEMES.map((v) => [v, syllables.filter((s) => s.loudest === v).length]));
  for (const v of VISEMES) assert.ok(counts[v] >= syllables.length / 20, `${v} in ${counts[v]} of ${syllables.length}: ${JSON.stringify(counts)}`);
  for (const v of VISEMES) assert.ok(counts[v] <= syllables.length / 2, `${v} not most of them: ${JSON.stringify(counts)}`);
});

test("a vowel seldom follows itself", () => {
  const { syllables } = speak(voice, 60, { seed: 3 });
  const repeats = syllables.slice(1).filter((s, i) => s.loudest === syllables[i].loudest).length;
  // Chosen as they are with no regard to the one before, about a fifth would be.
  assert.ok(repeats < syllables.length / 6, `${repeats} repeats in ${syllables.length}`);
});

test("a syllable that starts sharply is more often open (aa, ee), one that starts softly more often rounded (oh, ou)", () => {
  // Each 0.3 s: a sharp one jumps to its loudness and holds it, a soft one rises to it over 0.15 s.
  const sharp = (t: number) => (t % 0.3 < 0.15 ? 0.8 : 0);
  const soft = (t: number) => (t % 0.3 < 0.15 ? 0.8 * Math.sin((Math.PI * (t % 0.3)) / 0.15) : 0);
  const share = (level: (t: number) => number, of: Viseme[]) => {
    const { syllables } = speak(level, 90, { seed: 5 });
    return syllables.filter((s) => of.includes(s.loudest)).length / syllables.length;
  };
  const [openSharp, openSoft] = [share(sharp, ["aa", "ee"]), share(soft, ["aa", "ee"])];
  const [roundSharp, roundSoft] = [share(sharp, ["oh", "ou"]), share(soft, ["oh", "ou"])];
  assert.ok(openSharp > openSoft + 0.1, `open: ${openSharp} sharp, ${openSoft} soft`);
  assert.ok(roundSoft > roundSharp + 0.1, `rounded: ${roundSoft} soft, ${roundSharp} sharp`);
});

test("the jaw opens with the loudness whatever the shape, each vowel as far as its own shape goes, and shuts between syllables", () => {
  const { steps } = speak(voice, 20, { seed: 7 });
  for (const { level, shapes } of steps) {
    const open = Math.max(...VISEMES.map((v) => shapes[v]));
    assert.ok(open <= 1 + 1e-9, `at most wide open: ${open}`);
    // A little of aa under every other shape: 0.25 of how open it is, at least a sixth of the widest.
    if (open > 0.3) assert.ok(shapes.aa >= open / 6, `the jaw ${shapes.aa} under ${open} at ${level}`);
  }
  // Shut by the end of each gap between syllables (a gap is 0.125 s).
  for (const { t, shapes } of steps) if (t % 0.25 > 0.24) assert.ok(Math.max(...VISEMES.map((v) => shapes[v])) < 0.1, `shut at ${t}: ${JSON.stringify(shapes)}`);
});

test("off, it only opens and rounds a quarter as much, as before there were shapes", () => {
  for (const { shapes } of speak(voice, 5, { shapes: false }).steps) {
    assert.deepEqual([shapes.ih, shapes.ou, shapes.ee], [0, 0, 0]);
    assert.ok(Math.abs(shapes.oh - 0.25 * shapes.aa) < 1e-12);
  }
});

test("as many syllables, and as many of each vowel, at 30 and 60 frames a second", () => {
  const at = (fps: number) => speak(voice, 60, { fps, seed: 9 }).syllables.map((s) => s.loudest);
  const [slow, fast] = [at(30), at(60)];
  assert.equal(slow.length, fast.length);
  for (const v of VISEMES) {
    const [a, b] = [slow.filter((s) => s === v).length, fast.filter((s) => s === v).length];
    assert.ok(Math.abs(a - b) <= 0.15 * fast.length, `${v}: ${a} at 30, ${b} at 60`);
  }
});
