import { damp } from "./ease";

/**
 * The mouth as it speaks, from the loudness of the reply alone: how open it is, and which vowel's shape it takes.
 *
 * What reaches the avatar of the reply is one number, its loudness now (`levels.current.output`, the portal's meter of
 * what is played: the root mean square of the last few milliseconds, many times a second). The sound itself does not
 * reach it, so the vowels cannot be heard in it: a mouth shaped from the voice's spectrum needs the portal to hand the
 * audio over, which is a change to the portal. What the loudness does say is where each syllable starts and ends, how
 * sharply it starts and how loud it gets: each syllable is given one vowel, chosen at random, more often an open one
 * (aa, ee) for a sharp, loud start and a rounded one (oh, ou) for a soft one, and seldom the one before it again, so
 * the mouth moves through shapes as a speaking mouth does rather than opening and shutting the same way. It is a guess
 * that looks like speech, not lip reading.
 *
 * The VRM expressions it sets are the five mouth shapes every VRM model has, by their VRM 1.0 names (three-vrm gives a
 * VRM 0.x model's A, I, U, E and O these names too). Pure, so it is tested on its own; `random` is what chooses.
 */

export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh";
export const VISEMES: readonly Viseme[] = ["aa", "ih", "ou", "ee", "oh"];
export type MouthShapes = Record<Viseme, number>;

/**
 * Where a syllable starts and ends, on the eased loudness: it ends where the loudness falls under `DIP` of the loudest
 * it got (or under `OFF`), and the next starts once the loudness rises again by `RISE` over the lowest it fell to, and
 * over `ON`: from silence, or from a dip between two syllables run together. A loudness that only falls starts none.
 */
export const ON = 0.14;
export const OFF = 0.07;
export const DIP = 0.55;
export const RISE = 0.06;

/** How far the jaw opens for each vowel's shape, as a share of how open the mouth is: a rounded ou far less than aa. */
const OPEN: Readonly<MouthShapes> = { aa: 1, ih: 0.55, ou: 0.5, ee: 0.6, oh: 0.85 };
/** How often each vowel is chosen, before the start of the syllable weighs in. */
const COMMON: Readonly<MouthShapes> = { aa: 3, ih: 2, ou: 1.5, ee: 2, oh: 2 };

export interface MouthInput {
  /** Whether the reply is being played: the mouth is shut otherwise, whatever the loudness. */
  speaking: boolean;
  /** How loud the reply is now, 0 to 1. */
  output: number;
  dt: number;
  /** How wide it opens at the same loudness, as a factor (the `mouth` setting). */
  sensitivity: number;
  /** Whether it takes vowels' shapes (the `mouthShapes` setting), or only opens and shuts as it did before. */
  shapes: boolean;
}

export interface MouthState {
  /** The expressions to set, 0 to 1 each. */
  expressions: MouthShapes;
  /** The loudness, eased as the mouth follows it (the sensitivity aside): what the gestures read the stresses from. */
  level: number;
}

export function createMouth(random: () => number) {
  // How open the mouth is, and the loudness, each eased: fast as a syllable starts, more slowly as it ends. And the
  // loudness eased slowly, which a sharp start leaves far behind and a soft one does not.
  let open = 0;
  let level = 0;
  let slow = 0;
  // Between two syllables, and the lowest the loudness has fallen to since; the loudest the one under way has got.
  let between = true;
  let trough = 0;
  let peak = 0;
  let vowel: Viseme = "aa";
  // Each vowel's share of the shape now, eased towards the syllable's own, so one shape flows into the next.
  const shape: MouthShapes = { aa: 1, ih: 0, ou: 0, ee: 0, oh: 0 };

  /** A vowel for a syllable that starts `sharp`ly (0 to 1), loud or soft, and is unlike the one before. */
  const choose = (sharp: number): Viseme => {
    const weights = VISEMES.map((v) => {
      const lean = v === "aa" || v === "ee" ? 1 + sharp : v === "oh" || v === "ou" ? 2 - sharp : 1;
      return COMMON[v] * lean * (v === vowel ? 0.3 : 1);
    });
    let pick = random() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < VISEMES.length; i++) {
      pick -= weights[i];
      if (pick < 0) return VISEMES[i];
    }
    return VISEMES[VISEMES.length - 1];
  };

  return {
    step({ speaking, output, dt, sensitivity, shapes }: MouthInput): MouthState {
      const heard = speaking ? output : 0;
      slow = damp(slow, heard, 12, dt);
      // How far the loudness is over its slow easing: near nothing as a soft syllable starts, most of it at a sharp one.
      const sharp = Math.min(1, Math.max(0, (heard - slow) / 0.5));
      level = damp(level, heard, heard > level ? 40 : 13, dt);
      const target = speaking ? Math.min(1, 1.6 * sensitivity * output) : 0;
      open = damp(open, target, target > open ? 40 : 13, dt);

      if (between) trough = Math.min(trough, level);
      if (between && level > ON && level > trough + RISE) {
        between = false;
        peak = level;
        vowel = choose(sharp);
      } else if (!between) {
        peak = Math.max(peak, level);
        if (level < Math.max(OFF, DIP * peak)) {
          between = true;
          trough = level;
        }
      }

      if (!shapes) return { expressions: { aa: open, ih: 0, ou: 0, ee: 0, oh: 0.25 * open }, level };
      for (const v of VISEMES) shape[v] = damp(shape[v], v === vowel ? 1 : 0, 20, dt);
      const expressions = {} as MouthShapes;
      for (const v of VISEMES) expressions[v] = open * shape[v] * OPEN[v];
      // The jaw opens with the loudness whatever the shape: a little of aa under the others.
      expressions.aa += 0.25 * open * (1 - shape.aa);
      return { expressions, level };
    },
  };
}
