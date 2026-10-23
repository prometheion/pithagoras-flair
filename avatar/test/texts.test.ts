import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { de } from "../src/de.ts";

/**
 * Every text the extension shows has its German (de.ts): each literal its code gives `t(` or `msg(`, read from its
 * sources, as the portal's own test of its texts reads the portal's. A text whose German names other `{…}` than its
 * English, and German for a text no longer said, fail too.
 */
const src = new URL("../src/", import.meta.url);
const said = new Set<string>();
for (const file of readdirSync(src).filter((name) => /\.tsx?$/.test(name))) {
  const code = readFileSync(new URL(file, src), "utf8");
  for (const [, quote, text] of code.matchAll(/\b(?:t|msg)\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) said.add(quote === '"' ? JSON.parse(`"${text}"`) : text.replace(/\\'/g, "'"));
}
const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

test("every text shown has its German, with the same places to fill in", () => {
  assert.ok(said.size > 40, `${said.size} texts found`);
  const missing = [...said].filter((text) => !(text in de));
  assert.deepEqual(missing, []);
  for (const text of said) assert.deepEqual(holes(de[text]), holes(text), text);
});

test("there is no German for a text the extension no longer says", () => {
  assert.deepEqual(Object.keys(de).filter((text) => !said.has(text)), []);
});
