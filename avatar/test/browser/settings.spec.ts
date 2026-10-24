import { expect, test, type APIRequestContext, type Locator, type Page, type Request, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../src/model-settings.ts";
import { DRAW_VERSION, portraitStamp } from "../../src/stage.ts";
import { tinyVrm0, tinyVrm1 } from "../tiny-vrm.ts";
import { tinyVrma } from "../tiny-vrma.ts";
import { readFileSync } from "node:fs";
import { sample } from "./fetch-models.ts";
import { VIEWER_LEFT, within } from "./frame.ts";

/**
 * The 3D Avatar's page in Settings, on the extension's test page: the gallery of models, added from files picked or
 * dropped, the free models it points to while there are none, a file refused in the page's words, what a model's
 * licence says, renaming, downloading and deleting it, the portrait made for an agent's card and made again when it
 * is out of date, the live preview with its framing, states and Talk, what can be set on a model and how it is saved,
 * its gesture clips, the page on a phone, and all of it in German.
 */

const API = "/api/x/%40pithagoras/flair-avatar";
// A 1-pixel PNG, for a portrait.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function open(page: Page, request: APIRequestContext, lang = "en", reset = true) {
  if (reset) await request.post("/reset");
  await page.goto(`/?lang=${lang}`);
  await page.waitForFunction(() => (window as any).harness?.ready);
  await page.evaluate(() => (window as any).harness.settings());
}
const add = (page: Page, files: { name: string; buffer: Buffer }[]) => page.getByTestId("flair-avatar-file").setInputFiles(files.map((f) => ({ ...f, mimeType: "application/octet-stream" })));
const addOne = (page: Page, buffer: Buffer, name = "tiny.vrm") => add(page, [{ name, buffer }]);
/** Files dropped on the gallery, as a person drops them from their desktop. */
async function drop(page: Page, files: { name: string; buffer: Buffer }[]) {
  const given = await page.evaluateHandle((list) => {
    const moved = new DataTransfer();
    for (const { name, bytes } of list) moved.items.add(new File([new Uint8Array(bytes)], name));
    return moved;
  }, files.map(({ name, buffer }) => ({ name, bytes: [...buffer] })));
  const target = page.locator('[data-testid="flair-avatar-empty"], button[data-model]').first();
  for (const kind of ["dragenter", "dragover", "drop"]) await target.dispatchEvent(kind, { dataTransfer: given });
}
const cards = (page: Page) => page.locator("button[data-model]");
const studio = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const isPortrait = (r: Request) => r.method() === "PUT" && new URL(r.url()).pathname.endsWith("/portrait");
const isSettings = (r: Request) => r.method() === "PUT" && new URL(r.url()).pathname.endsWith("/settings");
const listed = async (request: APIRequestContext) => (await (await request.get(`${API}/models`)).json()).models;
const drawn = (page: Page) => expect(page.getByTestId("flair-avatar-preview").locator(".flair-avatar")).toHaveAttribute("data-shown", "drawn", { timeout: 30_000 });

test("with no models, the page says how to add one and where free ones are", async ({ page, request }) => {
  await open(page, request);
  const empty = page.getByTestId("flair-avatar-empty");
  await expect(empty).toContainText("No models yet.");
  await expect(empty.getByRole("button", { name: "Add a model" })).toBeVisible();
  await expect(empty).toContainText("Choose a .vrm file, or drop one here");
  await expect(page.getByText("Free models to start with")).toBeVisible();
  const links = page.getByRole("link");
  await expect(links).toHaveText(["AvatarSample_B", "VRM1_Constraint_Twist_Sample", "Vita", "VRoid Studio"]);
  const hrefs = [
    "https://raw.githubusercontent.com/pixiv/ChatVRM/main/public/AvatarSample_B.vrm",
    "https://raw.githubusercontent.com/pixiv/three-vrm/5a3242b66124386c32b085c6693d9059040e72e5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
    "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vita.vrm",
    "https://vroid.com/en/studio",
  ];
  for (const [i, href] of hrefs.entries()) {
    await expect(links.nth(i)).toHaveAttribute("href", href);
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    await expect(links.nth(i)).toHaveAttribute("rel", "noreferrer noopener");
  }
});

test("a model is added from its file, chosen, said to be added, and given a portrait made in the browser", async ({ page, request }) => {
  await open(page, request);
  const portrait = page.waitForRequest(isPortrait);
  await addOne(page, Buffer.from(tinyVrm1()));
  await expect(cards(page)).toHaveCount(1);
  const card = cards(page).first();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("Tiny");
  await expect(card).toContainText("VRM 1.0 · 0 MB");
  await expect(page.getByRole("status").filter({ hasText: "Added Tiny." })).toHaveCount(1);
  expect((await portrait).headers()["content-type"]).toBe("image/png");
  expect(new URL((await portrait).url()).searchParams.get("stamp")).toBe(portraitStamp(DEFAULT_SETTINGS));
  await expect(card.locator("img")).toBeVisible();
  await expect(studio(page, "Tiny")).toBeVisible();
  // The empty state's list is gone, and the gallery starts with the card that adds another.
  await expect(page.getByText("Free models to start with")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add a model/ })).toBeVisible();
  await expect(page.locator("li").first().getByRole("button", { name: /Add a model/ })).toBeVisible();
});

test("models dropped on the page are added one after another, and one refused is said by its name while the others are added", async ({ page, request }) => {
  await open(page, request);
  await drop(page, [{ name: "tiny.vrm", buffer: Buffer.from(tinyVrm1()) }]);
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Added Tiny." })).toHaveCount(1);
  await drop(page, [
    { name: "notes.vrm", buffer: Buffer.from("not a model") },
    { name: "zero.vrm", buffer: Buffer.from(tinyVrm0()) },
  ]);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveText("notes.vrm: This is not a VRM file.");
  // The one added last is chosen.
  await expect(cards(page).filter({ hasText: "Tiny Zero" })).toHaveAttribute("aria-pressed", "true");
  // Two picked at once, too.
  await request.post("/reset");
  await open(page, request);
  await add(page, [
    { name: "one.vrm", buffer: Buffer.from(tinyVrm1()) },
    { name: "zero.vrm", buffer: Buffer.from(tinyVrm0()) },
  ]);
  await expect(cards(page)).toHaveCount(2);
});

test("a file that is not a VRM model is refused in the page's words", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from("not a model"), "notes.vrm");
  await expect(page.getByRole("alert")).toHaveText("This is not a VRM file.");
  await addOne(page, Buffer.from(tinyVrm1((json) => delete json.extensions.VRMC_vrm.humanoid.humanBones.head)));
  await expect(page.getByRole("alert")).toHaveText("The model has no head bone, which an avatar needs.");
  await addOne(page, Buffer.from(tinyVrm1((json) => (json.images = [{ uri: "https://tracker.example.invalid/beacon.png" }]))));
  await expect(page.getByRole("alert")).toHaveText("The model loads parts of itself from outside its file, which this extension does not allow.");
  await expect(page.getByTestId("flair-avatar-empty")).toBeVisible();
});

test("choosing a card shows its model, with what its licence says as badges and the whole of it folded", async ({ page, request }) => {
  await open(page, request);
  await add(page, [
    { name: "one.vrm", buffer: Buffer.from(tinyVrm1()) },
    { name: "zero.vrm", buffer: Buffer.from(tinyVrm0()) },
  ]);
  await expect(cards(page)).toHaveText([/Tiny.*VRM 1\.0 · 0 MB/, /Tiny Zero.*VRM 0\.x · 0 MB/]);
  await cards(page).first().click();
  const one = studio(page, "Tiny");
  await expect(one.getByRole("list", { name: "Licence" }).getByRole("listitem")).toHaveText(["Commercial use allowed", "No credit needed", "Redistribution allowed"]);
  const details = one.locator("details");
  await expect(details).not.toHaveAttribute("open");
  await expect(details.locator("summary")).toContainText("Licence details");
  await expect(details.locator("summary")).toContainText("vrm.dev/licenses/1.0/");
  await details.locator("summary").click();
  for (const [label, value] of [
    ["Authors", "Pithagoras Flair tests"],
    ["Licence", "https://vrm.dev/licenses/1.0/"],
    ["Use as an avatar", "Everyone"],
    ["Commercial use", "Companies too"],
    ["Credit", "Not required"],
    ["Redistribution", "Allowed"],
  ]) {
    await expect(details.locator("dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  await expect(details.getByRole("link", { name: "https://vrm.dev/licenses/1.0/" })).toHaveAttribute("rel", "noreferrer noopener");
  await expect(details).toContainText("What the model says of its own licence. It is the author's, not this extension's.");

  await cards(page).nth(1).click();
  await expect(cards(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page).first()).toHaveAttribute("aria-pressed", "false");
  const zero = studio(page, "Tiny Zero");
  await expect(zero.getByRole("list", { name: "Licence" }).getByRole("listitem")).toHaveText(["Commercial use allowed", "Credit not stated", "Redistribution allowed"]);
  await expect(zero.locator("details summary")).toContainText("CC0");
});

test("a model is renamed in place: Enter and clicking away keep the name, Escape and an empty name do not", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const field = () => page.getByRole("textbox", { name: "Rename" });
  // The name itself, and the Rename button.
  await studio(page, "Tiny").getByRole("heading", { level: 3 }).getByRole("button").click();
  await field().fill("Alicia");
  await field().press("Enter");
  await expect(studio(page, "Alicia").getByRole("heading", { level: 3 })).toHaveText("Alicia");
  await expect(studio(page, "Alicia").getByRole("heading", { level: 3 }).getByRole("button")).toBeFocused();
  await studio(page, "Alicia").getByRole("button", { name: "Rename", exact: true }).click();
  await field().fill("Not kept");
  await field().press("Escape");
  await expect(field()).toHaveCount(0);
  await expect(studio(page, "Alicia").getByRole("heading", { level: 3 })).toHaveText("Alicia");
  await studio(page, "Alicia").getByRole("button", { name: "Rename", exact: true }).click();
  await field().fill("  ");
  await field().press("Enter");
  await expect(field()).toHaveCount(0);
  await expect(studio(page, "Alicia").getByRole("heading", { level: 3 })).toHaveText("Alicia");
  await studio(page, "Alicia").getByRole("button", { name: "Rename", exact: true }).click();
  await field().fill("Bea");
  await page.getByText("Look and motion").click();
  await expect(studio(page, "Bea").getByRole("heading", { level: 3 })).toHaveText("Bea");
  expect((await listed(request))[0].name).toBe("Bea");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a model's file is downloaded by its name, and the model is deleted after asking", async ({ page, request }) => {
  await open(page, request);
  await add(page, [
    { name: "one.vrm", buffer: Buffer.from(tinyVrm1()) },
    { name: "zero.vrm", buffer: Buffer.from(tinyVrm0()) },
  ]);
  await cards(page).first().click();
  const [one] = await listed(request);
  const download = studio(page, "Tiny").getByRole("link", { name: "Download" });
  await expect(download).toHaveAttribute("href", `${API}/models/${one.id}/file`);
  await expect(download).toHaveAttribute("download", "Tiny.vrm");
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("Tiny.vrm");

  await studio(page, "Tiny").getByRole("button", { name: "Delete" }).click();
  // The next by name is chosen, and its card has the focus.
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page).first()).toBeFocused();
  await studio(page, "Tiny Zero").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("flair-avatar-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a model" })).toBeFocused();
  expect(await page.evaluate(() => (window as any).harness.asked)).toEqual([
    "Delete Tiny? Agents that use it show the orb again.",
    "Delete Tiny Zero? Agents that use it show the orb again.",
  ]);
});

test("the preview draws the bust voice mode draws, or the face, in the state chosen, and Talk plays a turn", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  await drawn(page);
  const gl = page.getByTestId("flair-avatar-preview").locator(".flair-avatar-gl");
  await expect(gl).toHaveAttribute("data-framing", "bust");
  const framing = page.getByRole("radiogroup", { name: "Framing" });
  await framing.getByRole("radio", { name: "Face" }).click();
  await expect(gl).toHaveAttribute("data-framing", "face");
  await framing.getByRole("radio", { name: "Bust" }).click();
  await expect(gl).toHaveAttribute("data-framing", "bust");

  const states = page.getByRole("radiogroup", { name: "Preview state" }).getByRole("radio");
  await expect(states).toHaveText(["Idle", "Listening", "Speaking", "Thinking", "Muted"]);
  const checked = page.getByRole("radiogroup", { name: "Preview state" }).locator('[aria-checked="true"]');
  await expect(checked).toHaveText("Speaking");
  await states.nth(3).click();
  await expect(checked).toHaveText("Thinking");
  await states.nth(2).click();

  // Listening 2.5 s, thinking 2 s, speaking 4 s, then the state chosen before.
  // Its name says what pressing it does: Talk, then Stop while the turn plays.
  const talk = page.getByRole("button", { name: "Talk" });
  await expect(talk).not.toHaveAttribute("aria-pressed");
  await expect(talk).toHaveAccessibleDescription("Plays a made-up turn: you talk, it thinks, then it answers.");
  // When each is seen, waited for as the page changes (an assertion's retries come up to a second apart), and how
  // long each step lasted: from one step to the next, as each is timed from its own start.
  const seen = async (part: Locator) => {
    await part.waitFor({ timeout: 6000 });
    return Date.now() / 1000;
  };
  const state = (name: string) => page.getByRole("radiogroup", { name: "Preview state" }).getByRole("radio", { name, exact: true, checked: true });
  await talk.click();
  const stop = page.getByRole("button", { name: "Stop" });
  const listening = await seen(state("Listening"));
  await expect(stop).toBeVisible();
  const thinking = await seen(state("Thinking"));
  const speaking = await seen(state("Speaking"));
  const done = await seen(talk);
  expect(Math.abs(thinking - listening - 2.5)).toBeLessThan(0.4);
  expect(Math.abs(speaking - thinking - 2)).toBeLessThan(0.4);
  expect(Math.abs(done - speaking - 4)).toBeLessThan(0.4);
  await expect(checked).toHaveText("Speaking");

  // Stopped part way, or by choosing a state.
  await states.nth(0).click();
  await talk.click();
  await expect(checked).toHaveText("Listening");
  await stop.click();
  await expect(checked).toHaveText("Idle");
  await talk.click();
  await states.nth(4).click();
  await expect(checked).toHaveText("Muted");
  await expect(talk).toBeVisible();
});

test("a slider is saved as it is let go, drawn before, and its portrait made again; Reset to defaults saves them all, and Undo puts them back", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  await drawn(page);
  const sent: Request[] = [];
  page.on("request", (r) => isSettings(r) && sent.push(r));
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.00×");
  await zoom.focus();
  const zoomed = portraitStamp({ ...DEFAULT_SETTINGS, zoom: 1.2 });
  const portrait = page.waitForRequest((r) => isPortrait(r) && new URL(r.url()).searchParams.get("stamp") === zoomed);
  for (let i = 0; i < 4; i++) await zoom.press("ArrowRight");
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.20×");
  await expect(studio(page, "Tiny")).toContainText("1.20×");
  // One save for each key let go, the newest last, one at a time.
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.2 });
  expect(sent.length).toBeLessThanOrEqual(4);
  expect(sent.at(-1)!.postDataJSON()).toEqual({ settings: { zoom: 1.2 } });
  await portrait;

  const reset = page.getByRole("button", { name: "Reset to defaults" });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect.poll(() => sent.at(-1)!.postDataJSON()).toEqual({ settings: {} });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.00×");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({});
  // The same button, Undo now, with the focus still on it, until something else is changed.
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Back to the defaults." })).toHaveCount(1);
  await undo.click();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.2 });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.20×");
  await expect(reset).toBeFocused();
  await expect(page.getByText("Back to the defaults.")).toHaveCount(0);
  await reset.click();
  await zoom.focus();
  await zoom.press("ArrowLeft");
  await expect(undo).toHaveCount(0);
  await zoom.press("ArrowRight");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({});
  await expect(reset).toBeDisabled();
});

test("a slider set as a screen reader sets it, with no key, pointer or focus, is saved; and dragged with the mouse, once as it is let go", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const sent: Request[] = [];
  page.on("request", (r) => isSettings(r) && sent.push(r));
  const zoom = page.getByRole("slider", { name: "Zoom" });
  // The value set as the input's own setter sets it, then its input and change events, as a screen reader's gesture does.
  await zoom.evaluate((slider: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "1.3");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.30×");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.3 });
  expect(sent).toHaveLength(1);
  expect(await zoom.evaluate((slider) => slider === document.activeElement)).toBe(false);

  // Held and moved, then let go: drawn as it moves, saved once.
  await page.getByRole("slider", { name: "Height" }).scrollIntoViewIfNeeded();
  const box = (await page.getByRole("slider", { name: "Height" }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 5 });
  await expect(page.getByRole("slider", { name: "Height" })).toHaveAttribute("aria-valuetext", "+10 cm");
  expect(sent).toHaveLength(1);
  await page.mouse.up();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.3, height: 0.1 });
  expect(sent).toHaveLength(2);
});

test("a key pressed while a save's list waits behind a portrait's steps from what was saved, and what is saved is what is shown", async ({ page, request }) => {
  await open(page, request);
  // The new model's portrait is held, and each list asked for once the slider is changed, so their answers come in the
  // order a slow machine can give them: the save's list asked for, the portrait's after it, and the save's answered first.
  let portrait: Route | undefined;
  await page.route((url) => url.pathname.endsWith("/portrait"), (route) => {
    if (route.request().method() === "PUT" && !portrait) portrait = route;
    else void route.continue();
  });
  const lists: Route[] = [];
  let holding = false;
  await page.route((url) => url.pathname.endsWith("/models"), (route) => {
    if (holding && route.request().method() === "GET") lists.push(route);
    else void route.continue();
  });
  const made = page.waitForRequest(isPortrait);
  await addOne(page, Buffer.from(tinyVrm1()));
  await made;
  await expect.poll(() => portrait).toBeDefined();
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.00×");
  holding = true;
  await zoom.focus();
  await zoom.press("ArrowRight");
  await expect.poll(() => lists.length).toBe(1);
  await portrait!.continue();
  await expect.poll(() => lists.length).toBe(2);
  await lists[0].continue();
  // The save's answer is taken in once the avatars' list is asked for after it (modelsChanged), and what it changed is
  // drawn in the frames after that.
  await expect.poll(() => lists.length).toBe(3);
  await page.evaluate(() => new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn))));
  // Not the list from before the save, which the next key would step from.
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.05×");
  await zoom.press("ArrowRight");
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.10×");
  holding = false;
  for (const list of lists.slice(1)) await list.continue();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.1 });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.10×");
});

test("each slider says its value as it is shown, and the switch and the choices save at once", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const slider = (name: string) => page.getByRole("slider", { name, exact: true });
  for (const [name, said] of [["Zoom", "1.00×"], ["Height", "0 cm"], ["Brightness", "100%"], ["Warmth", "Neutral"]]) await expect(slider(name)).toHaveAttribute("aria-valuetext", said);
  await slider("Height").focus();
  await slider("Height").press("ArrowRight");
  await expect(slider("Height")).toHaveAttribute("aria-valuetext", "+1 cm");
  await slider("Warmth").focus();
  await slider("Warmth").press("ArrowLeft");
  await expect(slider("Warmth")).toHaveAttribute("aria-valuetext", "Cooler 5%");
  await expect(slider("Zoom")).toHaveAccessibleDescription("How close the camera is.");

  // All of them at once, each in its group, a value set apart from the default in the accent colour.
  const group = (name: string) => page.getByRole("group", { name, exact: true });
  for (const [name, sliders] of [
    ["Camera", ["Zoom", "Height"]],
    ["Light", ["Brightness", "Warmth"]],
    ["Motion", ["Overall motion", "Breathing and sway", "Leaning in", "Gestures"]],
    ["Eyes", ["Blinking"]],
    ["Voice", ["Mouth sensitivity"]],
    ["Arms", ["Arm angle"]],
  ] as const) {
    await expect(group(name).getByRole("slider")).toHaveCount(sliders.length);
    for (const one of sliders) await expect(group(name).getByRole("slider", { name: one, exact: true })).toBeVisible();
  }
  await expect(group("Motion").getByRole("switch", { name: "Thinking pose" })).toBeVisible();
  await expect(group("Voice").getByRole("switch", { name: "Mouth shapes" })).toHaveAttribute("aria-checked", "true");
  await expect(group("Eyes").getByRole("radiogroup", { name: "Gaze" })).toBeVisible();
  const value = (name: string) => page.getByRole("slider", { name, exact: true }).locator("xpath=preceding-sibling::span/span[2]");
  await expect(value("Height")).toHaveClass(/text-accent/);
  await expect(value("Zoom")).not.toHaveClass(/text-accent/);
  for (const [name, said] of [["Overall motion", "100%"], ["Breathing and sway", "100%"], ["Blinking", "About 15 a minute"], ["Leaning in", "100%"], ["Gestures", "100%"]]) {
    await expect(slider(name)).toHaveAttribute("aria-valuetext", said);
  }

  const sent: Request[] = [];
  page.on("request", (r) => isSettings(r) && sent.push(r));
  await page.getByRole("switch", { name: "Thinking pose" }).click();
  await expect(page.getByRole("switch", { name: "Thinking pose" })).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false });
  const gaze = page.getByRole("radiogroup", { name: "Gaze" });
  await expect(page.getByText("Its eyes stay on you, moving a little now and then.")).toBeVisible();
  await gaze.getByRole("radio", { name: "Around" }).click();
  await expect(gaze.getByRole("radio", { name: "Around" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Its eyes wander while nothing is said, and come back to you when you talk or it speaks.")).toBeVisible();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false, gaze: "around" });
  await page.getByRole("switch", { name: "Mouth shapes" }).click();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false, gaze: "around", mouthShapes: false });
  await slider("Gestures").focus();
  await slider("Gestures").press("ArrowLeft");
  await expect(slider("Gestures")).toHaveAttribute("aria-valuetext", "95%");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false, gaze: "around", mouthShapes: false, gestures: 0.95 });
  expect(sent.length).toBe(4);
  await expect(slider("Mouth sensitivity")).toHaveAttribute("aria-valuetext", "100%");
  await expect(slider("Arm angle")).toHaveAttribute("aria-valuetext", "69°");
});

test("a gesture clip is uploaded, listed by its file's name, replaced and removed; one that is not a VRM Animation is refused in the page's words", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const motion = page.getByRole("group", { name: "Motion", exact: true });
  const wave = motion.getByRole("group", { name: "Wave", exact: true });
  const chin = motion.getByRole("group", { name: "Hand to the chin", exact: true });
  await expect(wave).toContainText("As voice mode starts. Built in.");
  await expect(chin).toContainText("When the agent thinks for more than a moment. Built in.");
  await expect(wave.getByRole("button", { name: "Remove" })).toHaveCount(0);
  const pick = (gesture: string, name: string, buffer: Uint8Array) => page.getByTestId(`flair-avatar-clip-${gesture}`).setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) });

  await pick("greeting", "hello.vrma", tinyVrma());
  await expect(wave).toContainText("hello.vrma");
  await expect.poll(async () => (await listed(request))[0].clips?.greeting?.name).toBe("hello.vrma");
  await expect(chin).toContainText("Built in.");
  // Settings saved after keep it, and Reset to defaults leaves it: a clip is a file, not a setting.
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await zoom.focus();
  await zoom.press("ArrowRight");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({});
  expect((await listed(request))[0].clips.greeting.name).toBe("hello.vrma");

  await pick("greeting", "again.vrma", tinyVrma((json) => (json.asset.generator = "another")));
  await expect(wave).toContainText("again.vrma");
  await expect(wave.getByRole("button", { name: "Replace" })).toBeVisible();
  await pick("thinking", "model.vrma", tinyVrm1());
  await expect(page.getByRole("alert")).toHaveText("This is not a VRM Animation file.");
  await expect(chin).toContainText("Built in.");
  await wave.getByRole("button", { name: "Remove" }).click();
  await expect(wave).toContainText("Built in.");
  await expect.poll(async () => (await listed(request))[0].clips).toEqual({});
});

test("Try waves in the preview, whatever state it shows", async ({ page, request }) => {
  const file = sample("twist");
  test.skip(!file, "the sample model could not be fetched");
  await open(page, request);
  await addOne(page, readFileSync(file!), "twist.vrm");
  await drawn(page);
  const preview = '[data-testid="flair-avatar-preview"] canvas';
  // Speaking, as the preview starts: no wave of its own.
  await page.waitForTimeout(2000);
  const before = await within(page, VIEWER_LEFT, preview);
  await page.getByRole("group", { name: "Wave", exact: true }).getByRole("button", { name: "Try" }).click();
  await expect.poll(() => within(page, VIEWER_LEFT, preview), { timeout: 30_000, intervals: [200] }).toBeGreaterThan(before + 1000);
});

test("a refused save is said over the page, and the controls show what is saved again", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  await page.route((url) => url.pathname.endsWith("/settings"), (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The disk is full" }) }));
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await zoom.focus();
  await zoom.press("ArrowRight");
  await expect(page.getByRole("alert")).toHaveText("The disk is full");
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.00×");
});

test("with less motion asked for by the system, the Motion group says what that leaves", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const note = "Your system asks for less motion: breathing, sway, eye movement and gestures stay off, and leaning in and the thinking pose are at most half as strong, whatever is set here.";
  await expect(page.getByText(note)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request, "en", false);
  await expect(page.getByRole("group", { name: "Motion", exact: true }).getByText(note)).toBeVisible();
});

test("a portrait made before the drawing changed is made again when the page is opened, and a current one is not", async ({ page, request }) => {
  await request.post("/reset");
  const added = await request.post(`${API}/models?name=tiny.vrm`, { data: Buffer.from(tinyVrm1()), headers: { "content-type": "application/octet-stream" } });
  const { model } = await added.json();
  // As an older version of the drawing stamped it.
  await request.put(`${API}/models/${model.id}/portrait?stamp=0:old`, { data: PNG, headers: { "content-type": "image/png" } });
  const portrait = page.waitForRequest(isPortrait);
  await open(page, request, "en", false);
  const stamp = new URL((await portrait).url()).searchParams.get("stamp")!;
  expect(stamp.startsWith(`${DRAW_VERSION}:`)).toBe(true);
  expect(stamp).toBe(portraitStamp(DEFAULT_SETTINGS));
  await expect.poll(async () => (await listed(request))[0].portraitStamp).toBe(portraitStamp(DEFAULT_SETTINGS));

  // Opened again, nothing is due.
  let sent = 0;
  page.on("request", (r) => isPortrait(r) && sent++);
  await open(page, request, "en", false);
  await page.waitForTimeout(3000);
  expect(sent).toBe(0);
});

test("the preview is wider than the settings beside it and stays in view as they scroll; on a phone it is over them, held at the top, its states one row", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const preview = page.getByRole("region", { name: "Preview" });
  const zoom = page.getByRole("slider", { name: "Zoom" });
  const [square, slider] = [(await preview.boundingBox())!, (await zoom.boundingBox())!];
  expect(square.width).toBeGreaterThan(slider.width);
  expect(Math.abs(square.width - square.height)).toBeLessThan(1);
  // Beside: the settings start at the square's top, not under it.
  expect(slider.x).toBeGreaterThan(square.x + square.width);
  expect(slider.y).toBeLessThan(square.y + square.height);
  const held = async () => {
    await page.getByRole("slider", { name: "Arm angle" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const box = (await preview.boundingBox())!;
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeLessThan(40);
    return box;
  };
  await held();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 375, height: 812 });
  const over = (await preview.boundingBox())!;
  expect(over.y + over.height).toBeLessThan((await zoom.boundingBox())!.y);
  // A third of the screen's height, so the settings have the rest.
  expect(over.height).toBeLessThan(812 * 0.35);
  const states = page.getByRole("radiogroup", { name: "Preview state" }).getByRole("radio");
  const tops = await states.evaluateAll((all) => all.map((state) => state.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
  await held();
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
});

/** Models of their own name each, `Tiny 1` and on: a file differs by its name, and the server keeps one of each file. */
const named = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `tiny-${i + 1}.vrm`, buffer: Buffer.from(tinyVrm1((json) => (json.extensions.VRMC_vrm.meta.name = `Tiny ${i + 1}`))) }));

test("on a phone the page is one column: the gallery one row that scrolls sideways, the card that adds one first, and nothing wider than the screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, request);
  await add(page, named(5));
  await expect(cards(page)).toHaveCount(5);
  const added = (await page.getByRole("button", { name: /Add a model/ }).boundingBox())!;
  const boxes = await cards(page).evaluateAll((all) => all.map((card) => card.getBoundingClientRect().toJSON() as DOMRect));
  for (const box of boxes) expect(Math.abs(box.top - added.y)).toBeLessThan(1);
  expect(boxes[0].left).toBeGreaterThan(added.x + added.width);
  // The last cards are past the screen's edge, in the row, which scrolls; the page does not.
  expect(boxes.at(-1)!.left).toBeGreaterThan(375);
  const row = page.locator("ul").filter({ has: cards(page).first() });
  expect(await row.evaluate((list) => list.scrollWidth > list.clientWidth)).toBe(true);
  await cards(page).last().scrollIntoViewIfNeeded();
  await expect(cards(page).last()).toBeInViewport();
  const preview = await page.getByRole("region", { name: "Preview" }).boundingBox();
  const settings = await page.getByRole("group", { name: "Camera", exact: true }).boundingBox();
  expect(preview!.y + preview!.height).toBeLessThan(settings!.y);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
});

test("choosing a card brings its preview into view, as little as it takes, and not when it is in view already", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await open(page, request);
  await add(page, named(3));
  await page.evaluate(() => window.scrollTo(0, 0));
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).not.toBeInViewport({ ratio: 1 });
  // Where the page is once it has stopped scrolling: the same twice, a quarter of a second apart.
  const settled = async () => {
    let at = -1;
    await expect.poll(async () => {
      const was = at;
      at = await page.evaluate(() => window.scrollY);
      return at === was;
    }, { intervals: [250] }).toBe(true);
    return at;
  };
  await cards(page).nth(1).click();
  await expect(studio(page, "Tiny 2")).toBeVisible();
  await settled();
  await expect(preview).toBeInViewport({ ratio: 1 });
  // Brought up to the screen's bottom edge, not to its top: the gallery is still above it.
  const bottom = await preview.evaluate((square) => square.closest(".sticky")!.getBoundingClientRect().bottom);
  expect(Math.abs(bottom - 600)).toBeLessThan(2);
  const scrolled = await settled();
  await cards(page).nth(2).click();
  await expect(studio(page, "Tiny 3")).toBeVisible();
  // Not scrolled again: at most the pixel the browser rounds a position to.
  expect(Math.abs((await settled()) - scrolled)).toBeLessThanOrEqual(1);
});

test("in German, all of it", async ({ page, request }) => {
  await open(page, request, "de");
  await expect(page.getByRole("region", { name: "Modelle" })).toBeVisible();
  const empty = page.getByTestId("flair-avatar-empty");
  await expect(empty).toContainText("Noch keine Modelle.");
  await expect(empty).toContainText("Füge eine VRM-Datei hinzu, um einem Agenten im Sprachmodus eine 3D-Figur zu geben.");
  await expect(empty).toContainText("Wähle eine .vrm-Datei oder lege eine hier ab");
  await expect(page.getByRole("button", { name: "Modell hinzufügen" })).toBeVisible();
  await expect(page.getByText("Kostenlose Modelle für den Anfang")).toBeVisible();
  await expect(page.getByText("Von pixiv. VRM 1.0, 10 MB.", { exact: false })).toBeVisible();
  await addOne(page, Buffer.from("not a model"), "notes.vrm");
  await expect(page.getByRole("alert")).toHaveText("Das ist keine VRM-Datei.");
  await addOne(page, Buffer.from(tinyVrm1()));
  await expect(page.getByRole("status").filter({ hasText: "Tiny hinzugefügt." })).toHaveCount(1);
  const one = studio(page, "Tiny");
  await expect(one.getByRole("list", { name: "Lizenz" }).getByRole("listitem")).toHaveText(["Kommerzielle Nutzung erlaubt", "Keine Namensnennung nötig", "Weitergabe erlaubt"]);
  await one.locator("details summary").click();
  await expect(one.locator("details summary")).toContainText("Lizenzdetails");
  for (const [label, value] of [
    ["Autoren", "Pithagoras Flair tests"],
    ["Nutzung als Avatar", "Alle"],
    ["Kommerzielle Nutzung", "Auch Unternehmen"],
    ["Namensnennung", "Nicht erforderlich"],
    ["Weitergabe", "Erlaubt"],
  ]) {
    await expect(one.locator("dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  for (const name of ["Umbenennen", "Löschen", "Probegespräch"]) await expect(one.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(one.getByRole("link", { name: "Herunterladen" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Ausschnitt" }).getByRole("radio")).toHaveText(["Brustbild", "Gesicht"]);
  await expect(page.getByRole("radiogroup", { name: "Vorschauzustand" }).getByRole("radio")).toHaveText(["Ruhend", "Hört zu", "Spricht", "Denkt nach", "Stumm"]);
  await expect(one).toContainText("Spielt eine erfundene Runde ab: Du sprichst, es denkt nach, dann antwortet es.");
  await expect(one).toContainText("Aussehen und Bewegung");
  for (const name of ["Kamera", "Licht", "Bewegung", "Augen", "Stimme", "Arme"]) await expect(one.getByRole("group", { name, exact: true })).toBeVisible();
  for (const [name, said] of [["Zoom", "1,00×"], ["Höhe", "0 cm"], ["Helligkeit", "100\u00a0%"], ["Wärme", "Neutral"]]) {
    await expect(page.getByRole("slider", { name, exact: true })).toHaveAttribute("aria-valuetext", said);
  }
  for (const [name, said] of [["Bewegung insgesamt", "100\u00a0%"], ["Atmen und Wiegen", "100\u00a0%"], ["Blinzeln", "Etwa 15 pro Minute"], ["Vorbeugen", "100\u00a0%"]]) {
    await expect(page.getByRole("slider", { name, exact: true })).toHaveAttribute("aria-valuetext", said);
  }
  await expect(page.getByRole("switch", { name: "Denkpose" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Mundformen" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Gesten", exact: true })).toHaveAttribute("aria-valuetext", "100\u00a0%");
  const bewegung = one.getByRole("group", { name: "Bewegung", exact: true });
  await expect(bewegung).toContainText("Gestenclips");
  for (const name of ["Winken", "Hand ans Kinn"]) {
    const row = bewegung.getByRole("group", { name, exact: true });
    await expect(row).toContainText("Eingebaut.");
    for (const button of ["Ausprobieren", "Hochladen"]) await expect(row.getByRole("button", { name: button, exact: true })).toBeVisible();
  }
  await page.getByTestId("flair-avatar-clip-greeting").setInputFiles({ name: "kein.vrma", mimeType: "application/octet-stream", buffer: Buffer.from(tinyVrm1()) });
  await expect(page.getByRole("alert")).toHaveText("Das ist keine VRM-Animationsdatei.");
  await expect(page.getByRole("radiogroup", { name: "Blick" }).getByRole("radio")).toHaveText(["Auf dich", "Umher"]);
  await expect(page.getByRole("slider", { name: "Empfindlichkeit des Munds" })).toHaveAccessibleDescription("Wie weit sich der Mund bei gleicher Lautstärke öffnet. Erhöhe sie für eine leise Stimme.");
  await expect(page.getByRole("slider", { name: "Armwinkel" })).toHaveAttribute("aria-valuetext", "69°");
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await zoom.focus();
  await zoom.press("ArrowRight");
  await one.getByRole("button", { name: "Auf Standard zurücksetzen", exact: true }).click();
  await expect(one.getByRole("button", { name: "Rückgängig", exact: true })).toBeVisible();
  await expect(one.getByRole("status").filter({ hasText: "Auf Standard zurückgesetzt." })).toHaveCount(1);
});
