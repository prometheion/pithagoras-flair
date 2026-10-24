import { test } from "node:test";
import assert from "node:assert/strict";
import { BadSettings, changed, checkSettings, DEFAULT_SETTINGS, GAZES, RANGES, withDefaults, type ModelSettings } from "../src/model-settings.ts";

/** What can be set on a model: its defaults and ranges, what is taken from the page and what is refused. */

const numbers = Object.keys(DEFAULT_SETTINGS).filter((key) => typeof DEFAULT_SETTINGS[key as keyof ModelSettings] === "number");

test("every number has a range, every default is in its range and on its step", () => {
  assert.deepEqual(Object.keys(RANGES).sort(), numbers.sort());
  for (const [key, { min, max, step }] of Object.entries(RANGES)) {
    const value = DEFAULT_SETTINGS[key as keyof typeof RANGES];
    assert.ok(min < max && value >= min && value <= max, `${key}: ${value} in ${min} to ${max}`);
    const steps = (value - min) / step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${key}: ${value} on a step of ${step} from ${min}`);
  }
  assert.ok(GAZES.includes(DEFAULT_SETTINGS.gaze));
});

test("what the page sends is taken as it is: nothing, some of the settings, or all of them", () => {
  assert.deepEqual(checkSettings({}), {});
  assert.deepEqual(checkSettings({ zoom: 1.2, gaze: "around" }), { zoom: 1.2, gaze: "around" });
  assert.deepEqual(checkSettings({ ...DEFAULT_SETTINGS }), DEFAULT_SETTINGS);
  // The ends of each range are in it.
  for (const [key, { min, max }] of Object.entries(RANGES)) {
    assert.deepEqual(checkSettings({ [key]: min }), { [key]: min });
    assert.deepEqual(checkSettings({ [key]: max }), { [key]: max });
  }
  assert.deepEqual(checkSettings({ thinkingPose: false }), { thinkingPose: false });
});

test("anything else is refused, naming the setting it is about", () => {
  const refused = (given: unknown, detail: string | undefined) =>
    assert.throws(
      () => checkSettings(given),
      (e: unknown) => e instanceof BadSettings && e.code === "bad-settings" && e.detail === detail,
      JSON.stringify(given),
    );
  refused({ size: 2 }, "size");
  refused({ zoom: 1, __proto__x: 1 }, "__proto__x");
  refused({ zoom: "1.2" }, "zoom");
  refused({ zoom: NaN }, "zoom");
  refused({ zoom: Infinity }, "zoom");
  refused({ zoom: null }, "zoom");
  for (const [key, { min, max }] of Object.entries(RANGES)) {
    refused({ [key]: min - 0.01 }, key);
    refused({ [key]: max + 0.01 }, key);
  }
  refused({ thinkingPose: "yes" }, "thinkingPose");
  refused({ thinkingPose: 1 }, "thinkingPose");
  refused({ gaze: "away" }, "gaze");
  refused({ gaze: undefined }, "gaze");
  // Not settings at all.
  for (const whole of [null, undefined, [], [1], 3, "zoom"]) refused(whole, undefined);
});

test("a record's settings are filled with the defaults, and what differs from them is what is saved", () => {
  assert.deepEqual(withDefaults(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(withDefaults({}), DEFAULT_SETTINGS);
  assert.deepEqual(withDefaults({ zoom: 1.5, gaze: "around" }), { ...DEFAULT_SETTINGS, zoom: 1.5, gaze: "around" });
  // A setting a later version no longer has is dropped.
  assert.deepEqual(withDefaults({ zoom: 1.5, gone: 2 } as Partial<ModelSettings>), { ...DEFAULT_SETTINGS, zoom: 1.5 });
  assert.notEqual(withDefaults(undefined), DEFAULT_SETTINGS, "a copy, not the defaults themselves");

  assert.deepEqual(changed(withDefaults(undefined)), {});
  assert.deepEqual(changed(withDefaults({ zoom: 1.5, thinkingPose: false, armDown: 1.2 })), { zoom: 1.5, thinkingPose: false });
  assert.deepEqual(changed({ ...DEFAULT_SETTINGS, warmth: -0.4, mouth: 2 }), { warmth: -0.4, mouth: 2 });
});
