/**
 * What can be set on a model to change how it is drawn and how it moves, as the Settings page shows it beside the
 * model's preview, the server half keeps it in the model's own record (`settings`, only what differs from the
 * defaults), and the stage and the motion read it in every frame. Pure, for both halves and their tests.
 *
 * Each value is a factor on what the model does without it, or the place it moves to: the defaults draw and move a
 * model exactly as it was drawn before there were settings. The settings are the model's, not an agent's: two agents
 * with one model look the same.
 */

export interface ModelSettings {
  /** How close the camera is, as a factor on its distance in both framings: 2 is half as far. */
  zoom: number;
  /** How far the model is drawn higher in its box, in metres: the camera and what it looks at move down by it. */
  height: number;
  /** How strongly the lights fall on it, as a factor on both. */
  brightness: number;
  /** The lights' colour, from white towards a cool blue (-1) or a warm orange (+1). */
  warmth: number;
  /**
   * All of its own movement at once (breathing, sway, eye movement, nodding, leaning in, the thinking pose and every
   * gesture), as a factor.
   */
  motion: number;
  /** How much it breathes and its head sways, as a factor. */
  breathing: number;
  /** How often it blinks, as a factor: 2 is twice as often. */
  blinkRate: number;
  /** How far it leans in while the person is heard, as a factor. */
  lean: number;
  /** Whether the head takes the thinking pose while the agent works on its answer. */
  thinkingPose: boolean;
  /**
   * How much it gestures, as a factor: its hands and head on the stressed syllables of what it says, its nods while the
   * person talks and at their pauses, the wave as voice mode starts and the hand to the chin on a long think, and the
   * shifts of weight, stretches and tilts of the head while it waits. 0 is none of them.
   */
  gestures: number;
  /** Where its eyes go while nothing is said: at the person, or around. */
  gaze: Gaze;
  /** How wide the mouth opens at the same loudness, as a factor. */
  mouth: number;
  /**
   * Whether the mouth takes the shapes of vowels as it speaks (aa, ih, ou, ee, oh, each syllable one of them), or only
   * opens and shuts, as it did before there were shapes.
   */
  mouthShapes: boolean;
  /** How far the upper arms come down from the T-pose a VRM model is made in, in radians. */
  armDown: number;
}

export type Gaze = "you" | "around";
export const GAZES: readonly Gaze[] = ["you", "around"];

/** The settings that are numbers, each set on a slider, and those that are on or off, each a switch. */
export type NumberKey = { [K in keyof ModelSettings]: ModelSettings[K] extends number ? K : never }[keyof ModelSettings];
export type SwitchKey = { [K in keyof ModelSettings]: ModelSettings[K] extends boolean ? K : never }[keyof ModelSettings];

export const DEFAULT_SETTINGS: Readonly<ModelSettings> = {
  zoom: 1,
  height: 0,
  brightness: 1,
  warmth: 0,
  motion: 1,
  breathing: 1,
  blinkRate: 1,
  lean: 1,
  thinkingPose: true,
  gestures: 1,
  gaze: "you",
  mouth: 1,
  mouthShapes: true,
  armDown: 1.2,
};

/** The sliders' ranges and steps: the page draws them from this, and `checkSettings` holds a value to its range. */
export const RANGES: Readonly<Record<NumberKey, { min: number; max: number; step: number }>> = {
  zoom: { min: 0.6, max: 1.6, step: 0.05 },
  height: { min: -0.1, max: 0.1, step: 0.01 },
  brightness: { min: 0.5, max: 1.5, step: 0.05 },
  warmth: { min: -1, max: 1, step: 0.05 },
  motion: { min: 0, max: 1.5, step: 0.05 },
  breathing: { min: 0, max: 2, step: 0.05 },
  blinkRate: { min: 0.5, max: 2, step: 0.05 },
  lean: { min: 0, max: 2, step: 0.05 },
  gestures: { min: 0, max: 2, step: 0.05 },
  mouth: { min: 0.5, max: 2, step: 0.05 },
  armDown: { min: 0.8, max: 1.45, step: 0.01 },
};

/** Why what the page sent was refused: `detail` is the setting it was about, none when it was not an object at all. */
export class BadSettings extends Error {
  readonly code = "bad-settings";
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumberKey = (key: string): key is NumberKey => Object.hasOwn(RANGES, key);
const SWITCHES: readonly SwitchKey[] = ["thinkingPose", "mouthShapes"];
const isSwitchKey = (key: string): key is SwitchKey => SWITCHES.includes(key as SwitchKey);

/**
 * What the page sent, checked: an object of settings, each a number in its range, a switch true or false, and
 * `gaze` one of `GAZES`; the keys it gives and no others. A value off its slider's step is taken: the page only sends
 * values on a step, and one between them is drawn as well. Throws `BadSettings` for anything else.
 */
export function checkSettings(given: unknown): Partial<ModelSettings> {
  if (!isObject(given)) throw new BadSettings("The settings are not an object");
  const checked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(given)) {
    if (isNumberKey(key)) {
      const { min, max } = RANGES[key];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new BadSettings(`The setting ${key} is not a number`, key);
      if (value < min || value > max) throw new BadSettings(`The setting ${key} is outside ${min} to ${max}`, key);
    } else if (isSwitchKey(key)) {
      if (typeof value !== "boolean") throw new BadSettings(`The setting ${key} is not true or false`, key);
    } else if (key === "gaze") {
      if (!GAZES.includes(value as Gaze)) throw new BadSettings(`The setting gaze is not one of ${GAZES.join(", ")}`, key);
    } else {
      throw new BadSettings(`There is no setting called ${key}`, key);
    }
    checked[key] = value;
  }
  return checked as Partial<ModelSettings>;
}

/** A model's settings, whole: the defaults where its record gives none, and nothing it gives that is not a setting. */
export function withDefaults(given: Partial<ModelSettings> | undefined): ModelSettings {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ModelSettings)[]) {
    if (given?.[key] !== undefined) (settings as Record<string, unknown>)[key] = given[key];
  }
  return settings;
}

/** The values that differ from the defaults: what the page saves, so a default changed later reaches what was never set. */
export function changed(settings: ModelSettings): Partial<ModelSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([key, value]) => DEFAULT_SETTINGS[key as keyof ModelSettings] !== value)) as Partial<ModelSettings>;
}
