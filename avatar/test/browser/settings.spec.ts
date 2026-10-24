import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../src/model-settings.ts";
import { DRAW_VERSION, portraitStamp } from "../../src/stage.ts";
import { tinyVrm0, tinyVrm1 } from "../tiny-vrm.ts";

/**
 * The 3D Avatar's page in Settings, on the extension's test page: the gallery of models, added from files picked or
 * dropped, the free models it points to while there are none, a file refused in the page's words, what a model's
 * licence says, renaming, downloading and deleting it, the portrait made for an agent's card and made again when it
 * is out of date, the live preview with its framing, states and Talk, what can be set on a model and how it is saved,
 * the page on a phone, and all of it in German.
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
  // The empty state's list is gone, and the gallery ends with the card that adds another.
  await expect(page.getByText("Free models to start with")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add a model/ })).toBeVisible();
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
  const talk = page.getByRole("button", { name: "Talk" });
  await expect(talk).toHaveAttribute("aria-pressed", "false");
  const started = Date.now();
  await talk.click();
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toHaveAttribute("aria-pressed", "true");
  await expect(checked).toHaveText("Listening");
  const at = async (text: string) => {
    await expect(checked).toHaveText(text, { timeout: 6000 });
    return (Date.now() - started) / 1000;
  };
  expect(Math.abs((await at("Thinking")) - 2.5)).toBeLessThan(0.5);
  expect(Math.abs((await at("Speaking")) - 4.5)).toBeLessThan(0.5);
  await expect(talk).toBeVisible({ timeout: 6000 });
  expect(Math.abs((Date.now() - started) / 1000 - 8.5)).toBeLessThan(0.5);
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
  await expect(talk).toHaveAttribute("aria-pressed", "false");
});

test("a slider is saved as it is let go, drawn before, and its portrait made again; Reset to defaults saves them all", async ({ page, request }) => {
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
  await expect(reset).toBeDisabled();
  await expect.poll(async () => (await listed(request))[0].settings).toEqual({});
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

  const tabs = page.getByRole("tablist", { name: "Settings of this model" });
  await expect(tabs.getByRole("tab")).toHaveText(["Camera and light", "Motion", "Voice and pose"]);
  // Arrow keys move along the tabs, as the portal's do.
  await tabs.getByRole("tab", { name: "Camera and light" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Motion" })).toHaveAttribute("aria-selected", "true");
  for (const [name, said] of [["Overall motion", "100%"], ["Breathing and sway", "100%"], ["Blinking", "About 15 a minute"], ["Leaning in", "100%"]]) await expect(slider(name)).toHaveAttribute("aria-valuetext", said);

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
  expect(sent.length).toBe(2);

  await tabs.getByRole("tab", { name: "Voice and pose" }).click();
  await expect(slider("Mouth sensitivity")).toHaveAttribute("aria-valuetext", "100%");
  await expect(slider("Arm angle")).toHaveAttribute("aria-valuetext", "69°");
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  await addOne(page, Buffer.from(tinyVrm1()));
  const note = "Your system asks for less motion: breathing, sway and eye movement stay off, and leaning in and the thinking pose are at most half as strong, whatever is set here.";
  await expect(page.getByText(note)).toHaveCount(0);
  await page.getByRole("tab", { name: "Motion" }).click();
  await expect(page.getByText(note)).toBeVisible();
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

test("on a phone the page is one column: two cards to a row, the preview above the controls, and nothing wider than the screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, request);
  await add(page, [
    { name: "one.vrm", buffer: Buffer.from(tinyVrm1()) },
    { name: "zero.vrm", buffer: Buffer.from(tinyVrm0()) },
  ]);
  await expect(cards(page)).toHaveCount(2);
  const [first, second] = [await cards(page).nth(0).boundingBox(), await cards(page).nth(1).boundingBox()];
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
  const added = await page.getByRole("button", { name: /Add a model/ }).boundingBox();
  expect(added!.y).toBeGreaterThan(first!.y + first!.height);
  const preview = await page.getByRole("region", { name: "Preview" }).boundingBox();
  const tabs = await page.getByRole("tablist").boundingBox();
  expect(preview!.y + preview!.height).toBeLessThan(tabs!.y);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
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
  for (const name of ["Umbenennen", "Löschen", "Probegespräch", "Auf Standard zurücksetzen"]) await expect(one.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(one.getByRole("link", { name: "Herunterladen" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Ausschnitt" }).getByRole("radio")).toHaveText(["Brustbild", "Gesicht"]);
  await expect(page.getByRole("radiogroup", { name: "Vorschauzustand" }).getByRole("radio")).toHaveText(["Ruhend", "Hört zu", "Spricht", "Denkt nach", "Stumm"]);
  await expect(one).toContainText("Spielt eine erfundene Runde ab: Du sprichst, es denkt nach, dann antwortet es.");
  await expect(one).toContainText("Aussehen und Bewegung");
  await expect(page.getByRole("tablist", { name: "Einstellungen dieses Modells" }).getByRole("tab")).toHaveText(["Kamera und Licht", "Bewegung", "Stimme und Haltung"]);
  for (const [name, said] of [["Zoom", "1,00×"], ["Höhe", "0 cm"], ["Helligkeit", "100\u00a0%"], ["Wärme", "Neutral"]]) {
    await expect(page.getByRole("slider", { name, exact: true })).toHaveAttribute("aria-valuetext", said);
  }
  await page.getByRole("tab", { name: "Bewegung" }).click();
  for (const [name, said] of [["Bewegung insgesamt", "100\u00a0%"], ["Atmen und Wiegen", "100\u00a0%"], ["Blinzeln", "Etwa 15 pro Minute"], ["Vorbeugen", "100\u00a0%"]]) {
    await expect(page.getByRole("slider", { name, exact: true })).toHaveAttribute("aria-valuetext", said);
  }
  await expect(page.getByRole("switch", { name: "Denkpose" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Blick" }).getByRole("radio")).toHaveText(["Auf dich", "Umher"]);
  await page.getByRole("tab", { name: "Stimme und Haltung" }).click();
  await expect(page.getByRole("slider", { name: "Empfindlichkeit des Munds" })).toHaveAccessibleDescription("Wie weit sich der Mund bei gleicher Lautstärke öffnet. Erhöhe sie für eine leise Stimme.");
  await expect(page.getByRole("slider", { name: "Armwinkel" })).toHaveAttribute("aria-valuetext", "69°");
});
