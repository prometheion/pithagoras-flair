import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../src/model-settings.ts";
import { portraitStamp } from "../../src/stage.ts";
import { tinyVrm1 } from "../tiny-vrm.ts";

/**
 * The 3D Avatar's page in Settings, on the extension's test page: adding a model from a file, what its licence says,
 * a file refused in the page's words, renaming and deleting, the portrait made for an agent's card, the live preview,
 * and all of it in German.
 */

const API = "/api/x/%40pithagoras/flair-avatar";
// A 1-pixel PNG, for a portrait.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAAJRU5ErkJggg==", "base64");

async function open(page: Page, request: APIRequestContext, lang = "en", reset = true) {
  if (reset) await request.post("/reset");
  await page.goto(`/?lang=${lang}`);
  await page.waitForFunction(() => (window as any).harness?.ready);
  await page.evaluate(() => (window as any).harness.settings());
}
const add = (page: Page, buffer: Buffer, name = "tiny.vrm") => page.getByTestId("flair-avatar-file").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
const row = (page: Page) => page.locator("li[data-model]");
/** A portrait the page sends, with what it says it was drawn with. */
const painted = (page: Page) => page.waitForRequest((r) => r.method() === "PUT" && new URL(r.url()).pathname.endsWith("/portrait"));

test("a model is added from its file, listed with what its licence says, previewed, and given a portrait", async ({ page, request }) => {
  await open(page, request);
  await expect(page.getByTestId("empty")).toHaveText("No models yet.");
  const portrait = painted(page);
  await add(page, Buffer.from(tinyVrm1()));
  await expect(row(page)).toHaveCount(1);
  const listed = row(page).first();
  await expect(listed).toContainText("Tiny");
  await expect(listed).toContainText("VRM 1.0 · 0 MB");
  for (const [label, value] of [
    ["Authors", "Pithagoras Flair tests"],
    ["Licence", "https://vrm.dev/licenses/1.0/"],
    ["Use as an avatar", "Everyone"],
    ["Commercial use", "Companies too"],
    ["Credit", "Not required"],
    ["Redistribution", "Allowed"],
  ]) {
    await expect(listed.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  await expect(listed.getByRole("link", { name: "https://vrm.dev/licenses/1.0/" })).toHaveAttribute("rel", "noreferrer noopener");
  await expect(listed).toContainText("What the model says of its own licence. It is the author's, not this extension's.");

  // The portrait, made in this browser and kept by the server half, is the row's picture.
  expect((await portrait).headers()["content-type"]).toBe("image/png");
  expect(new URL((await portrait).url()).searchParams.get("stamp")).toBe(portraitStamp(DEFAULT_SETTINGS));
  await expect(listed.locator("img")).toBeVisible();

  const preview = page.getByTestId("flair-avatar-preview");
  await expect(preview.locator(".flair-avatar")).toHaveAttribute("data-shown", "drawn", { timeout: 30_000 });
  const states = page.getByRole("group", { name: "Preview state" }).getByRole("button");
  await expect(states).toHaveText(["Idle", "Listening", "Speaking", "Thinking", "Muted"]);
  await expect(states.nth(2)).toHaveAttribute("aria-pressed", "true");
  await states.nth(3).click();
  await expect(states.nth(3)).toHaveAttribute("aria-pressed", "true");
});

test("a file that is not a VRM model is refused in the page's words", async ({ page, request }) => {
  await open(page, request);
  await add(page, Buffer.from("not a model"), "notes.vrm");
  await expect(page.getByRole("alert")).toHaveText("This is not a VRM file.");
  await add(page, Buffer.from(tinyVrm1((json) => delete json.extensions.VRMC_vrm.humanoid.humanBones.head)));
  await expect(page.getByRole("alert")).toHaveText("The model has no head bone, which an avatar needs.");
  await add(page, Buffer.from(tinyVrm1((json) => (json.images = [{ uri: "https://tracker.example.invalid/beacon.png" }]))));
  await expect(page.getByRole("alert")).toHaveText("The model loads parts of itself from outside its file, which this extension does not allow.");
  await expect(page.getByTestId("empty")).toBeVisible();
});

test("a model is renamed with Enter, left as it was with Escape, and deleted after asking", async ({ page, request }) => {
  await open(page, request);
  await add(page, Buffer.from(tinyVrm1()));
  const listed = row(page).first();
  await listed.getByRole("button", { name: "Rename" }).click();
  await listed.getByRole("textbox", { name: "Rename" }).fill("Alicia");
  await listed.getByRole("textbox", { name: "Rename" }).press("Enter");
  await expect(listed.locator("p").first()).toHaveText("Alicia");
  await listed.getByRole("button", { name: "Rename" }).click();
  await listed.getByRole("textbox", { name: "Rename" }).fill("Not kept");
  await listed.getByRole("textbox", { name: "Rename" }).press("Escape");
  await expect(listed.locator("p").first()).toHaveText("Alicia");
  await listed.getByRole("button", { name: "Rename" }).click();
  await listed.getByRole("textbox", { name: "Rename" }).fill(" ");
  await listed.getByRole("textbox", { name: "Rename" }).press("Enter");
  await expect(page.getByRole("alert")).toHaveText("The name must be 1 to 80 characters.");
  await listed.getByRole("textbox", { name: "Rename" }).press("Escape");

  await listed.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("empty")).toBeVisible();
  expect(await page.evaluate(() => (window as any).harness.asked)).toEqual(["Delete Alicia? Agents that use it show the orb again."]);
});

test("in German, all of it", async ({ page, request }) => {
  await open(page, request, "de");
  await expect(page.getByRole("region", { name: "Modelle" })).toBeVisible();
  await expect(page.getByTestId("empty")).toHaveText("Noch keine Modelle.");
  await expect(page.getByRole("button", { name: "Modell hinzufügen" })).toBeVisible();
  await add(page, Buffer.from("not a model"), "notes.vrm");
  await expect(page.getByRole("alert")).toHaveText("Das ist keine VRM-Datei.");
  await add(page, Buffer.from(tinyVrm1()));
  const listed = row(page).first();
  for (const [label, value] of [
    ["Autoren", "Pithagoras Flair tests"],
    ["Nutzung als Avatar", "Alle"],
    ["Kommerzielle Nutzung", "Auch Unternehmen"],
    ["Namensnennung", "Nicht erforderlich"],
    ["Weitergabe", "Erlaubt"],
  ]) {
    await expect(listed.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  await expect(listed.getByRole("button")).toHaveText(["Vorschau", "Umbenennen", "Löschen"]);
  await expect(page.getByRole("group", { name: "Vorschauzustand" }).getByRole("button")).toHaveText(["Ruhend", "Hört zu", "Spricht", "Denkt nach", "Stumm"]);
});

test("a portrait made before the drawing changed is made again when the page is opened, and a current one is not", async ({ page, request }) => {
  await request.post("/reset");
  const added = await request.post(`${API}/models?name=tiny.vrm`, { data: Buffer.from(tinyVrm1()), headers: { "content-type": "application/octet-stream" } });
  const { model } = await added.json();
  // As an older version of the drawing stamped it.
  await request.put(`${API}/models/${model.id}/portrait?stamp=0:old`, { data: PNG, headers: { "content-type": "image/png" } });
  const portrait = painted(page);
  await open(page, request, "en", false);
  expect(new URL((await portrait).url()).searchParams.get("stamp")).toBe(portraitStamp(DEFAULT_SETTINGS));
  await expect.poll(async () => (await (await request.get(`${API}/models`)).json()).models[0].portraitStamp).toBe(portraitStamp(DEFAULT_SETTINGS));

  // Opened again, nothing is due.
  let sent = 0;
  page.on("request", (r) => r.method() === "PUT" && new URL(r.url()).pathname.endsWith("/portrait") && sent++);
  await open(page, request, "en", false);
  await page.waitForTimeout(3000);
  expect(sent).toBe(0);
});
