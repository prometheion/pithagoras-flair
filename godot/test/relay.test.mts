import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { mcpClient } from "../../shared/mcp.ts";
import { relay } from "../../shared/relay.ts";
import { LABELS, RUNS_CODE } from "../src/labels.ts";
import { fakeMcp, fakePortal, TOOLS } from "./fakes.mts";

/**
 * The server's tools as the extension's own in every chat: registered from the cache under the prefix, offered while
 * the server is installed, held by the guard, and their answers handed to the model as they came, pictures included.
 */

const server = await fakeMcp("tok");
after(() => server.close());

function setup(options: { installed?: boolean; dataDir?: string } = {}) {
  const fake = fakePortal();
  const state = { installed: options.installed ?? true };
  const mcp = mcpClient({ port: () => server.port, token: () => "tok" });
  const make = (dir = options.dataDir ?? fake.dataDir) =>
    relay({
      portal: fake.portal,
      prefix: "godot",
      mcp,
      labels: LABELS,
      acts: Object.fromEntries(RUNS_CODE.map((n) => [n, ["upload" as const]])),
      cacheFile: path.join(dir, "tools.json"),
      installed: () => state.installed,
      notRunning: "Godot is not running. The person can start it in Settings → Godot.",
    });
  return { fake, state, tools: make() };
}

test("nothing is offered or registered before the server has answered once", () => {
  const { fake } = setup();
  assert.deepEqual(fake.listed(), []);
  assert.deepEqual(fake.registered(), []);
});

test("the server's tools are the extension's, with the prefix, its schema, its instructions, the guard and one call at a time", async () => {
  const { fake, tools } = setup();
  assert.equal(await tools.refresh("img:1"), true);
  assert.equal(fake.counts.reloads, 1, "the open chats are given them");
  const registered = fake.registered();
  assert.deepEqual(registered.map((t) => t.name), TOOLS.map((t) => `godot_${t.name}`));
  assert.deepEqual(fake.listed().map((t) => t.name), registered.map((t) => t.name), "Settings → Tools lists them");
  for (const tool of registered) {
    const source = TOOLS.find((t) => `godot_${t.name}` === tool.name)!;
    assert.equal(tool.description, source.description);
    assert.deepEqual(tool.parameters, source.inputSchema);
    assert.equal(tool.label, LABELS[tool.name]);
    assert.deepEqual(tool.promptGuidelines, ["Tools for a real Godot 4 editor."]);
    assert.equal(tool.executionMode, "sequential");
    assert.equal(tool.guard.outside, true);
    assert.deepEqual(tool.guard.acts, RUNS_CODE.includes(tool.name) ? ["upload"] : undefined, tool.name);
  }
});

test("a call's text and pictures reach the model as they came, in order", async () => {
  const { fake, tools } = setup();
  await tools.refresh("img:1");
  server.answers.set("screenshot", { content: [{ type: "text", text: '{"target":"game"}' }, { type: "image", data: "iVBORw0K", mimeType: "image/png" }], isError: false });
  const shot = fake.registered().find((t) => t.name === "godot_screenshot");
  const result = await shot.execute("call-1", { target: "game" }, undefined);
  assert.deepEqual(result, { content: [{ type: "text", text: '{"target":"game"}' }, { type: "image", data: "iVBORw0K", mimeType: "image/png" }], details: {} });
  assert.deepEqual(server.seen.at(-1)!.params, { name: "screenshot", arguments: { target: "game" } });
});

test("a call the server says failed is a failed call, with what it said; nothing listening is the server not running", async () => {
  const { fake, tools } = setup();
  await tools.refresh("img:1");
  server.answers.set("stop", { content: [{ type: "text", text: "the editor is not running" }], isError: true });
  const stop = fake.registered().find((t) => t.name === "godot_stop");
  await assert.rejects(stop.execute("c", {}, undefined), /^Error: the editor is not running$/);

  const down = fakePortal();
  const kept = relay({ portal: down.portal, prefix: "godot", mcp: mcpClient({ port: () => 1, token: () => "tok" }), labels: LABELS, acts: {}, cacheFile: path.join(fake.dataDir, "tools.json"), installed: () => true, notRunning: "Godot is not running." });
  assert.ok(kept.known(), "the cache the other wrote");
  await assert.rejects(down.registered()[0].execute("c", {}, undefined), /^Error: Godot is not running\.$/);
});

test("the tools are kept for the owner alone, and a start after a restart has them before the server answers", async () => {
  const { fake, tools } = setup();
  await tools.refresh("img:1");
  const file = path.join(fake.dataDir, "tools.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).image, "img:1");
  const again = fakePortal();
  const second = relay({ portal: again.portal, prefix: "godot", mcp: mcpClient({ port: () => 1, token: () => "x" }), labels: LABELS, acts: {}, cacheFile: file, installed: () => true, notRunning: "" });
  assert.ok(second.known());
  assert.equal(again.registered().length, TOOLS.length);
});

test("the same tools again change nothing; changed ones are given to the chats once", async () => {
  const { fake, tools } = setup();
  await tools.refresh("img:1");
  assert.equal(await tools.refresh("img:1"), false);
  assert.equal(await tools.refresh("img:2"), false, "a new image with the same tools");
  assert.equal(fake.counts.reloads, 1);
  server.setTools([...TOOLS, { name: "new_tool", description: "A tool added later.", inputSchema: { type: "object", properties: {} } }]);
  try {
    assert.equal(await tools.refresh("img:3"), true);
    assert.equal(fake.counts.reloads, 2);
    const added = fake.registered().find((t) => t.name === "godot_new_tool");
    assert.equal(added.label, "godot_new_tool", "a tool the table does not name has its name as its label");
    assert.equal(added.guard.outside, true);
  } finally {
    server.setTools(TOOLS);
  }
});

test("while the server is not installed, and once it is removed, nothing is offered or registered", async () => {
  const { fake, state, tools } = setup();
  await tools.refresh("img:1");
  state.installed = false;
  assert.deepEqual(fake.listed(), []);
  assert.deepEqual(fake.registered(), []);
  state.installed = true;
  tools.forget();
  assert.equal(tools.known(), false);
  assert.deepEqual(fake.registered(), []);
  assert.throws(() => statSync(path.join(fake.dataDir, "tools.json")), /ENOENT/);
});
