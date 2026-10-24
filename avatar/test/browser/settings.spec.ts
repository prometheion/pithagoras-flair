import { expect, test, type APIRequestContext, type Locator, type Page, type Request, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../src/model-settings.ts";
import { DRAW_VERSION, portraitStamp } from "../../src/stage.ts";
import { readFileSync } from "node:fs";
import { tinyVrm0, tinyVrm1 } from "../tiny-vrm.ts";
import { tinyVrma } from "../tiny-vrma.ts";
import { sample } from "./fetch-models.ts";
import { played, seen, track, VIEWER_LEFT, watchFrames, within } from "./frame.ts";

/**
 * The 3D Avatar's page in Settings, on the extension's test page: the gallery of models, added from files picked or
 * dropped, the free models it points to while there are none, a file refused in the page's words, what a model's
 * licence says, renaming, downloading and deleting it, the portrait made for an agent's card and made again when it
 * is out of date, the live preview with its framing, states and Talk, what can be set on a model in its tabs and how it
 * is saved, each tab's Reset and Undo, its gesture clips, how tall the designer is on a laptop's screen, a larger one
 * and a phone, and all of it in German.
 */

const API = "/api/x/%40pithagoras/flair-avatar";
// A 1-pixel PNG, for a portrait.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function open(page: Page, request: APIRequestContext, lang = "en", reset = true) {
  if (reset) await request.post("/reset");
  await watchFrames(page);
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
/** A tab of the designer by its name, with the dot's word after it or not. */
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
/**
 * The fade of the part of the tabs' panel that scrolls, or of the row of tabs, towards an end with more past it: none,
 * or the mask's gradient, which goes to transparent at that end.
 */
const faded = (box: Locator) => box.evaluate((el) => {
  const mask = getComputedStyle(el).maskImage;
  if (mask === "none") return { start: false, end: false };
  // Its colour stops, after its direction where it has one: the browser leaves "to bottom", the default, out.
  const stops = mask.slice(mask.indexOf("(") + 1, -1).split(/,(?![^(]*\))/).map((stop) => stop.trim()).filter((stop) => !stop.startsWith("to "));
  return { start: stops[0].startsWith("rgba(0, 0, 0, 0)"), end: stops.at(-1)!.startsWith("rgba(0, 0, 0, 0)") };
});
const scroller = (page: Page) => page.getByRole("tabpanel").locator("> div").first();

/** The designer: the preview with its controls, and the tabs with their panel; the nearest that holds both. */
const designer = (page: Page) => page.getByRole("region", { name: "Preview" }).locator("xpath=ancestor::div[.//*[@role='tablist']][1]");

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
  await page.getByText("Saved as you change them", { exact: false }).click();
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

test("a slider is saved as it is let go, drawn before, and its portrait made again; a tab's Reset puts back that tab alone, and Undo puts it back", async ({ page, request }) => {
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

  // Something set on another tab, which the Camera tab's Reset leaves as it is.
  await tab(page, "Light").click();
  const warmth = page.getByRole("slider", { name: "Warmth" });
  await warmth.focus();
  await warmth.press("ArrowRight");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.2, warmth: 0.05 });
  await tab(page, "Camera").click();
  const reset = page.getByRole("button", { name: "Reset Camera" });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect.poll(() => sent.at(-1)!.postDataJSON()).toEqual({ settings: { warmth: 0.05 } });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.00×");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ warmth: 0.05 });
  // The same button, Undo now, with the focus still on it, until something else is changed; offered on that tab alone.
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeFocused();
  const said = page.getByRole("status").filter({ hasText: "Back to the defaults." });
  await expect(said).toHaveCount(1);
  await tab(page, "Light").click();
  await expect(undo).toHaveCount(0);
  await expect(said).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset Light" })).toBeEnabled();
  await tab(page, "Camera").click();
  await undo.click();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.2, warmth: 0.05 });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.20×");
  await expect(reset).toBeFocused();
  await expect(page.getByText("Back to the defaults.")).toHaveCount(0);
  await reset.click();
  await zoom.focus();
  await zoom.press("ArrowLeft");
  await expect(undo).toHaveCount(0);
  await zoom.press("ArrowRight");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ warmth: 0.05 });
  // A tab whose settings are all at their defaults has its Reset disabled; the Light tab's is not.
  await expect(reset).toBeDisabled();
  await tab(page, "Light").click();
  await expect(page.getByRole("button", { name: "Reset Light" })).toBeEnabled();
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

test("a change waiting behind a save on its way is sent as the page is closed, and again after that save while the page lives on", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  // The first save is held, so the next key's change waits behind it.
  let first: Route | undefined;
  await page.route((url) => url.pathname.endsWith("/settings"), (route) => {
    if (!first) first = route;
    else void route.continue();
  });
  const sent: unknown[] = [];
  page.on("request", (r) => isSettings(r) && sent.push(r.postDataJSON().settings));
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.00×");
  await zoom.focus();
  await zoom.press("ArrowRight");
  await expect.poll(() => first).toBeDefined();
  await zoom.press("ArrowRight");
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.10×");
  expect(sent).toEqual([{ zoom: 1.05 }]);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect.poll(() => sent).toEqual([{ zoom: 1.05 }, { zoom: 1.1 }]);
  await first!.continue();
  await expect.poll(() => sent).toEqual([{ zoom: 1.05 }, { zoom: 1.1 }, { zoom: 1.1 }]);
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ zoom: 1.1 });
  await expect(zoom).toHaveAttribute("aria-valuetext", "1.10×");
});

test("each tab has its own settings in the one panel, each slider says its value as it is shown, a tab with any set apart from its default has a dot that says so, and the switch and the choices save at once", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const slider = (name: string) => page.getByRole("slider", { name, exact: true });
  const panel = page.getByRole("tabpanel");
  const dot = (name: string) => tab(page, name).getByRole("img", { name: "Changed", exact: true });
  // Each tab shows its own settings and no others, and the panel is named by it; nothing is changed yet, so no tab has a dot.
  for (const [name, said] of [
    ["Camera", [["Zoom", "1.00×"], ["Height", "0 cm"]]],
    ["Light", [["Brightness", "100%"], ["Warmth", "Neutral"]]],
    ["Motion", [["Overall motion", "100%"], ["Breathing and sway", "100%"], ["Leaning in", "100%"]]],
    ["Eyes", [["Blinking", "About 15 a minute"]]],
    ["Voice", [["Mouth sensitivity", "100%"]]],
    ["Arms", [["Arm angle", "69°"], ["Gestures", "100%"]]],
  ] as const) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name, exact: true })).toBeVisible();
    await expect(panel.getByRole("slider")).toHaveCount(said.length);
    for (const [one, value] of said) await expect(panel.getByRole("slider", { name: one, exact: true })).toHaveAttribute("aria-valuetext", value);
    await expect(dot(name)).toHaveCount(0);
  }
  await tab(page, "Motion").click();
  await expect(panel.getByRole("switch", { name: "Thinking pose" })).toBeVisible();
  await tab(page, "Voice").click();
  await expect(panel.getByRole("switch", { name: "Mouth shapes" })).toHaveAttribute("aria-checked", "true");
  await tab(page, "Eyes").click();
  await expect(panel.getByRole("radiogroup", { name: "Gaze" })).toBeVisible();

  await tab(page, "Camera").click();
  await slider("Height").focus();
  await slider("Height").press("ArrowRight");
  await expect(slider("Height")).toHaveAttribute("aria-valuetext", "+1 cm");
  await expect(slider("Zoom")).toHaveAccessibleDescription("How close the camera is.");
  // A value set apart from the default in the accent colour, and its tab's dot, named for a screen reader.
  const value = (name: string) => page.getByRole("slider", { name, exact: true }).locator("xpath=preceding-sibling::span/span[2]");
  await expect(value("Height")).toHaveClass(/text-accent/);
  await expect(value("Zoom")).not.toHaveClass(/text-accent/);
  await expect(dot("Camera")).toHaveCount(1);
  await expect(tab(page, "Camera")).toHaveAccessibleName("Camera Changed");
  await expect(dot("Light")).toHaveCount(0);
  await tab(page, "Light").click();
  await slider("Warmth").focus();
  await slider("Warmth").press("ArrowLeft");
  await expect(slider("Warmth")).toHaveAttribute("aria-valuetext", "Cooler 5%");
  await expect(dot("Light")).toHaveCount(1);
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05 });

  const sent: Request[] = [];
  page.on("request", (r) => isSettings(r) && sent.push(r));
  await tab(page, "Motion").click();
  await expect(dot("Motion")).toHaveCount(0);
  await page.getByRole("switch", { name: "Thinking pose" }).click();
  await expect(page.getByRole("switch", { name: "Thinking pose" })).toHaveAttribute("aria-checked", "false");
  await expect(dot("Motion")).toHaveCount(1);
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false });
  await tab(page, "Eyes").click();
  const gaze = page.getByRole("radiogroup", { name: "Gaze" });
  await expect(page.getByText("Its eyes stay on you, moving a little now and then.")).toBeVisible();
  await gaze.getByRole("radio", { name: "Around" }).click();
  await expect(gaze.getByRole("radio", { name: "Around" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Its eyes wander while nothing is said, and come back to you when you talk or it speaks.")).toBeVisible();
  await expect(dot("Eyes")).toHaveCount(1);
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false, gaze: "around" });
  expect(sent.length).toBe(2);
  for (const name of ["Voice", "Arms"]) await expect(dot(name)).toHaveCount(0);
  await tab(page, "Voice").click();
  await page.getByRole("switch", { name: "Mouth shapes" }).click();
  await expect(dot("Voice")).toHaveCount(1);
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false, gaze: "around", mouthShapes: false });
  await tab(page, "Arms").click();
  await slider("Gestures").focus();
  await slider("Gestures").press("ArrowLeft");
  await expect(slider("Gestures")).toHaveAttribute("aria-valuetext", "95%");
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({ height: 0.01, warmth: -0.05, thinkingPose: false, gaze: "around", mouthShapes: false, gestures: 0.95 });
  await expect(dot("Arms")).toHaveCount(1);
  expect(sent.length).toBe(4);
});

test("the tabs are the portal's: arrows round the ends, Home and End, the tab shown selected and the one stop of Tab, and kept as another model is chosen", async ({ page, request }) => {
  await open(page, request);
  await add(page, [
    { name: "one.vrm", buffer: Buffer.from(tinyVrm1()) },
    { name: "zero.vrm", buffer: Buffer.from(tinyVrm0()) },
  ]);
  // The last one added is chosen once it is in: its card drawn again would take the focus from a tab.
  await expect(cards(page).filter({ hasText: "Tiny Zero" })).toHaveAttribute("aria-pressed", "true");
  const list = page.getByRole("tablist", { name: "Look and motion" });
  const tabs = list.getByRole("tab");
  await expect(tabs).toHaveText(["Camera", "Light", "Motion", "Eyes", "Voice", "Arms"]);
  const shown = async (name: string) => {
    await expect(tab(page, name)).toBeFocused();
    await expect(list.locator('[aria-selected="true"]')).toHaveText(name);
    // Only the tab shown is a stop for Tab; the panel is the one it controls, and is named by it.
    await expect(list.locator('[tabindex="0"]')).toHaveText(name);
    await expect(list.locator('[tabindex="-1"]')).toHaveCount(5);
    const panel = page.getByRole("tabpanel", { name, exact: true });
    await expect(panel).toBeVisible();
    expect(await tab(page, name).getAttribute("aria-controls")).toBe(await panel.getAttribute("id"));
  };
  await tab(page, "Camera").focus();
  await page.keyboard.press("ArrowRight");
  await shown("Light");
  await expect(page.getByRole("tabpanel").getByRole("slider", { name: "Brightness" })).toBeVisible();
  await page.keyboard.press("End");
  await shown("Arms");
  await page.keyboard.press("ArrowRight");
  await shown("Camera");
  await page.keyboard.press("ArrowLeft");
  await shown("Arms");
  await page.keyboard.press("Home");
  await shown("Camera");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await shown("Voice");
  // Tab leaves the row for what is in the panel.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("slider", { name: "Mouth sensitivity" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(tab(page, "Voice")).toBeFocused();

  // Another model shows the same tab.
  await cards(page).nth(1).click();
  await expect(studio(page, "Tiny Zero").getByRole("tab", { name: "Voice", selected: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Mouth sensitivity" })).toBeVisible();
});

test("a gesture clip is uploaded, listed by its file's name, replaced and removed; one that is not a VRM Animation is refused in the page's words", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  await tab(page, "Arms").click();
  const arms = page.getByRole("tabpanel", { name: "Arms", exact: true });
  const wave = arms.getByRole("group", { name: "Wave", exact: true });
  const chin = arms.getByRole("group", { name: "Hand to the chin", exact: true });
  await expect(wave).toContainText("As voice mode starts. Built in.");
  await expect(chin).toContainText("When the agent thinks for more than a moment. Built in.");
  await expect(wave.getByRole("button", { name: "Remove" })).toHaveCount(0);
  const pick = (gesture: string, name: string, buffer: Uint8Array) => page.getByTestId(`flair-avatar-clip-${gesture}`).setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) });

  await pick("greeting", "hello.vrma", tinyVrma());
  await expect(wave).toContainText("hello.vrma");
  await expect.poll(async () => (await listed(request))[0].clips?.greeting?.name).toBe("hello.vrma");
  await expect(chin).toContainText("Built in.");
  // Settings saved after keep it, and the tab's Reset leaves it: a clip is a file, not a setting.
  const angle = page.getByRole("slider", { name: "Arm angle" });
  await angle.focus();
  await angle.press("ArrowRight");
  await page.getByRole("button", { name: "Reset Arms" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({});
  expect((await listed(request))[0].clips.greeting.name).toBe("hello.vrma");
  await expect(wave).toContainText("hello.vrma");

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
  test.slow();
  await open(page, request);
  await addOne(page, readFileSync(file!), "twist.vrm");
  await drawn(page);
  const preview = '[data-testid="flair-avatar-preview"] canvas';
  // Speaking, as the preview starts: no wave of its own. Two seconds of its motion, which a slow renderer plays slowly (frame.ts).
  await played(page, 2);
  const before = await within(page, VIEWER_LEFT, preview);
  await tab(page, "Arms").click();
  await track(page, [VIEWER_LEFT]);
  await page.getByRole("group", { name: "Wave", exact: true }).getByRole("button", { name: "Try" }).click();
  // Every frame of a second of it, from the press.
  await played(page, 1);
  expect(Math.max(...(await seen(page)).map((f) => f.covered[0]))).toBeGreaterThan(before + 1000);
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

test("with less motion asked for by the system, the Motion tab says what that leaves", async ({ page, request }) => {
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const note = "Your system asks for less motion: breathing, sway, eye movement and gestures stay off, and leaning in and the thinking pose are at most half as strong, whatever is set here.";
  await expect(page.getByText(note)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request, "en", false);
  await expect(page.getByText(note)).toHaveCount(0);
  await tab(page, "Motion").click();
  await expect(page.getByRole("tabpanel", { name: "Motion", exact: true }).getByText(note)).toBeVisible();
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

test("beside the preview, the tabs' panel is as tall as its square whichever tab is shown, the designer fits the Settings dialog on a 1280 by 800 screen, and a larger screen makes it no taller", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const preview = page.getByRole("region", { name: "Preview" });
  const panel = page.getByRole("tabpanel");
  const square = (await preview.boundingBox())!;
  expect(Math.abs(square.width - square.height)).toBeLessThan(1);
  // Beside: the tabs start at the square's top, right of it.
  const tabs = (await page.getByRole("tablist", { name: "Look and motion" }).boundingBox())!;
  expect(tabs.x).toBeGreaterThan(square.x + square.width);
  expect(Math.abs(tabs.y - square.y)).toBeLessThan(1);
  // The Settings dialog shows 621 pixels of its page at this size: 92% of the window's height, less its header (57)
  // and its pane's padding (24 above and under), as the portal draws them (Modal.tsx, ConfigModal.tsx). The whole
  // designer is seen in that at once.
  const tall = async () => (await designer(page).boundingBox())!.height;
  const height = await tall();
  expect(height).toBeLessThanOrEqual(621);
  // Choosing a tab changes no height: the panel's (the square's), the designer's, the page's.
  const page0 = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  for (const name of ["Camera", "Light", "Motion", "Eyes", "Voice", "Arms"]) {
    await tab(page, name).click();
    expect(Math.abs((await panel.boundingBox())!.height - square.height)).toBeLessThan(1);
    expect(Math.abs((await tall()) - height)).toBeLessThan(1);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBe(page0);
    // What is in the tab is in the panel, scrolled inside it where it has more than fits.
    const scrolls = await panel.evaluate((p) => getComputedStyle(p.firstElementChild!).overflowY);
    expect(scrolls).toBe("auto");
    // All of each tab is seen, so none is faded as having more under it.
    expect(await faded(scroller(page))).toEqual({ start: false, end: false });
  }
  // The tallest tab has room without scrolling.
  await tab(page, "Motion").click();
  expect(await panel.evaluate((p) => p.firstElementChild!.scrollHeight <= p.firstElementChild!.clientHeight)).toBe(true);
  // A larger screen gives it no more height.
  for (const [width, h] of [[1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height: h });
    expect(Math.abs((await tall()) - height)).toBeLessThan(1);
  }
});

test("on a phone the preview is over the tabs, the panel as tall as its square, the states one row, and all of it seen at once; where the page goes on under it, the preview is held at the top", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const preview = page.getByRole("region", { name: "Preview" });
  const over = (await preview.boundingBox())!;
  expect(over.y + over.height).toBeLessThan((await page.getByRole("tablist", { name: "Look and motion" }).boundingBox())!.y);
  // 28% of the screen's height, and the panel as tall.
  expect(Math.abs(over.height - 812 * 0.28)).toBeLessThan(1);
  expect(Math.abs((await page.getByRole("tabpanel").boundingBox())!.height - over.height)).toBeLessThan(1);
  const states = page.getByRole("radiogroup", { name: "Preview state" }).getByRole("radio");
  const tops = await states.evaluateAll((all) => all.map((state) => state.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
  // No taller than the Settings dialog shows of its page on this phone: 94% of its height, less the dialog's header
  // (59) and the pane's padding (16 above and under).
  expect((await designer(page).boundingBox())!.height).toBeLessThanOrEqual(812 * 0.94 - 59 - 32);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);

  // Motion has more than its panel here: the panel fades out at its foot, so what is under it is seen to be there,
  // and at the top once it is scrolled; scrolled to the end, only there.
  await tab(page, "Motion").click();
  const inner = scroller(page);
  expect(await inner.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => faded(inner)).toEqual({ start: false, end: true });
  await inner.evaluate((el) => (el.scrollTop = 40));
  await expect.poll(() => faded(inner)).toEqual({ start: true, end: true });
  await inner.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => faded(inner)).toEqual({ start: true, end: false });
  await expect(page.getByRole("switch", { name: "Thinking pose" })).toBeInViewport();
  // Eyes has room: no fade.
  await tab(page, "Eyes").click();
  await expect.poll(() => faded(inner)).toEqual({ start: false, end: false });

  // With more of the page under it than the screen has room for, as on a shorter phone, the preview stays at the top
  // as the tabs and their panel scroll under it.
  await page.evaluate(() => (document.body.style.paddingBottom = "100vh"));
  await tab(page, "Motion").click();
  await page.getByRole("switch", { name: "Thinking pose" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const held = (await preview.boundingBox())!;
  expect(held.y).toBeGreaterThanOrEqual(-1);
  expect(held.y).toBeLessThan(40);
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
  const settings = await page.getByRole("tablist", { name: "Look and motion" }).boundingBox();
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
  await expect(one).toContainText("Wird beim Ändern gespeichert, für dieses Modell überall, wo es gezeigt wird: hier, im Sprachmodus und im Avatar-Dialog jedes Agenten.");
  const list = one.getByRole("tablist", { name: "Aussehen und Bewegung" });
  await expect(list.getByRole("tab")).toHaveText(["Kamera", "Licht", "Bewegung", "Augen", "Stimme", "Arme"]);
  const slider = (name: string) => page.getByRole("slider", { name, exact: true });
  for (const [name, said] of [["Zoom", "1,00×"], ["Höhe", "0 cm"]]) await expect(slider(name)).toHaveAttribute("aria-valuetext", said);
  await tab(page, "Licht").click();
  for (const [name, said] of [["Helligkeit", "100\u00a0%"], ["Wärme", "Neutral"]]) await expect(slider(name)).toHaveAttribute("aria-valuetext", said);
  await tab(page, "Bewegung").click();
  for (const [name, said] of [["Bewegung insgesamt", "100\u00a0%"], ["Atmen und Wiegen", "100\u00a0%"], ["Vorbeugen", "100\u00a0%"]]) await expect(slider(name)).toHaveAttribute("aria-valuetext", said);
  await expect(page.getByRole("switch", { name: "Denkpose" })).toBeVisible();
  await tab(page, "Augen").click();
  await expect(slider("Blinzeln")).toHaveAttribute("aria-valuetext", "Etwa 15 pro Minute");
  await expect(page.getByRole("radiogroup", { name: "Blick" }).getByRole("radio")).toHaveText(["Auf dich", "Umher"]);
  await tab(page, "Stimme").click();
  await expect(page.getByRole("switch", { name: "Mundformen" })).toBeVisible();
  await expect(slider("Empfindlichkeit des Munds")).toHaveAccessibleDescription("Wie weit sich der Mund bei gleicher Lautstärke öffnet. Erhöhe sie für eine leise Stimme.");
  await tab(page, "Arme").click();
  await expect(slider("Armwinkel")).toHaveAttribute("aria-valuetext", "69°");
  await expect(slider("Gesten")).toHaveAttribute("aria-valuetext", "100\u00a0%");
  const arme = page.getByRole("tabpanel", { name: "Arme", exact: true });
  await expect(arme).toContainText("Gestenclips");
  for (const name of ["Winken", "Hand ans Kinn"]) {
    const row = arme.getByRole("group", { name, exact: true });
    await expect(row).toContainText("Eingebaut.");
    for (const button of ["Ausprobieren", "Hochladen"]) await expect(row.getByRole("button", { name: button, exact: true })).toBeVisible();
  }
  await page.getByTestId("flair-avatar-clip-greeting").setInputFiles({ name: "kein.vrma", mimeType: "application/octet-stream", buffer: Buffer.from(tinyVrm1()) });
  await expect(page.getByRole("alert")).toHaveText("Das ist keine VRM-Animationsdatei.");
  await expect(one.getByRole("button", { name: "Arme zurücksetzen", exact: true })).toBeDisabled();
  await tab(page, "Kamera").click();
  const zoom = slider("Zoom");
  await zoom.focus();
  await zoom.press("ArrowRight");
  await expect(tab(page, "Kamera").getByRole("img", { name: "Geändert", exact: true })).toHaveCount(1);
  await one.getByRole("button", { name: "Kamera zurücksetzen", exact: true }).click();
  await expect(one.getByRole("button", { name: "Rückgängig", exact: true })).toBeVisible();
  await expect(one.getByRole("status").filter({ hasText: "Auf Standard zurückgesetzt." })).toHaveCount(1);

  // In the Settings dialog of a window 1024 pixels wide the card is 742 wide (1024 less the dialog's margins, 16 on
  // each side, and its border, its rail, 208, and its pane's padding, 20 on each side): the German tabs fit in one
  // row, none cut.
  await page.setViewportSize({ width: 742, height: 768 });
  expect(await list.evaluate((row) => row.scrollWidth <= row.clientWidth)).toBe(true);
  for (const each of await list.getByRole("tab").all()) expect(await each.evaluate((t) => t.scrollWidth <= t.clientWidth)).toBe(true);
  const [first, last] = [(await list.getByRole("tab").first().boundingBox())!, (await list.getByRole("tab").last().boundingBox())!];
  expect(Math.abs(first.y - last.y)).toBeLessThan(1);

  // On a phone 360 pixels wide the card is 300 wide (less the dialog's margins and border and its pane's padding,
  // 30 on each side, as the portal draws them): the six still fit, none cut, and the row has no fade.
  const uncut = async () => {
    expect(await list.evaluate((row) => row.scrollWidth <= row.clientWidth)).toBe(true);
    for (const each of await list.getByRole("tab").all()) {
      expect(await each.evaluate((t) => t.scrollWidth <= t.clientWidth)).toBe(true);
      const [box, row] = [(await each.boundingBox())!, (await list.boundingBox())!];
      expect(box.x).toBeGreaterThanOrEqual(row.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
    }
    expect(await faded(list)).toEqual({ start: false, end: false });
  };
  await page.setViewportSize({ width: 300, height: 740 });
  await uncut();
  // Narrower still (a phone 320 wide), the row scrolls across: it fades where more tabs are past its edge, and a tab
  // chosen there, half seen, is brought wholly into the row.
  await page.setViewportSize({ width: 260, height: 640 });
  expect(await list.evaluate((row) => row.scrollWidth > row.clientWidth)).toBe(true);
  await expect.poll(() => faded(list)).toEqual({ start: false, end: true });
  const arms = tab(page, "Arme");
  // Clicked where it is, as a finger would: Playwright's own click would scroll it into view first.
  await arms.evaluate((t: HTMLElement) => t.click());
  await expect(arms).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => {
    const [box, row] = [(await arms.boundingBox())!, (await list.boundingBox())!];
    return box.x + box.width <= row.x + row.width + 0.5;
  }).toBe(true);
  await expect.poll(() => faded(list)).toEqual({ start: true, end: false });
  await page.setViewportSize({ width: 300, height: 740 });
  await uncut();
});
