import { after, test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { mcpClient } from "../../shared/mcp.ts";
import { relay } from "../../shared/relay.ts";
import { ACTS, LABELS } from "../src/labels.ts";
import { fakeMcp, fakePortal, TOOLS } from "./fakes.mts";

/**
 * Godot's tools as the extension's own in every chat (shared/relay.ts): registered under the prefix with the guard
 * rules of labels.ts, and their answers handed to the model as they came, pictures included.
 */

const server = await fakeMcp("tok");
after(() => server.close());

function setup() {
  const fake = fakePortal();
  const mcp = mcpClient({ url: () => `http://127.0.0.1:${server.port}/mcp`, token: () => "tok" });
  const tools = relay({ portal: fake.portal, prefix: "godot", app: "Godot", mcp, labels: LABELS, acts: ACTS, cacheFile: path.join(fake.dataDir, "tools.json") });
  return { fake, tools };
}

test("nothing is offered or registered before the server has listed its tools", () => {
  const { fake, tools } = setup();
  tools.setInstalled(true);
  assert.deepEqual(fake.listed(), []);
  assert.deepEqual(fake.registered(), []);
});

test("the server's tools are Godot's, with the prefix, their schemas, the guard and one call at a time", async () => {
  const { fake, tools } = setup();
  tools.setInstalled(true);
  await tools.refresh();
  const registered = fake.registered();
  assert.deepEqual(registered.map((t) => t.name), TOOLS.map((t) => `godot_${t.name}`));
  assert.deepEqual(fake.listed().map((t) => t.name), registered.map((t) => t.name), "Settings → Tools lists them");
  for (const tool of registered) {
    const source = TOOLS.find((t) => `godot_${t.name}` === tool.name)!;
    assert.equal(tool.description, source.description);
    assert.deepEqual(tool.parameters, source.inputSchema);
    assert.equal(tool.label, LABELS[source.name]);
    assert.equal(tool.executionMode, "sequential");
    assert.deepEqual(tool.guard, source.name in ACTS ? { outside: true, acts: ["upload"] } : { outside: true }, tool.name);
  }
  assert.deepEqual(Object.keys(ACTS).sort(), ["attach_script", "execute_gdscript", "record", "run_project", "run_scene", "write_file"]);
});

test("a call's text and pictures reach the model as they came, in order", async () => {
  const { fake, tools } = setup();
  tools.setInstalled(true);
  await tools.refresh();
  server.answers.set("screenshot", { content: [{ type: "text", text: '{"target":"game"}' }, { type: "image", data: "iVBORw0K", mimeType: "image/png" }], isError: false });
  const shot = fake.registered().find((t) => t.name === "godot_screenshot");
  const result = await shot.execute("call-1", { target: "game" }, undefined);
  assert.deepEqual(result, { content: [{ type: "text", text: '{"target":"game"}' }, { type: "image", data: "iVBORw0K", mimeType: "image/png" }], details: {} });
  assert.deepEqual(server.seen.at(-1)!.params, { name: "screenshot", arguments: { target: "game" } });
});

test("a call the server says failed is a failed call with what it said; nothing listening is Godot not running", async () => {
  const { fake, tools } = setup();
  tools.setInstalled(true);
  await tools.refresh();
  server.answers.set("stop", { content: [{ type: "text", text: "the editor is not running" }], isError: true });
  const stop = fake.registered().find((t) => t.name === "godot_stop");
  await assert.rejects(stop.execute("c", {}, undefined), /^Error: the editor is not running$/);

  const down = fakePortal();
  relay({ portal: down.portal, prefix: "godot", app: "Godot", mcp: mcpClient({ url: () => "http://127.0.0.1:1/mcp", token: () => "tok" }), labels: LABELS, acts: ACTS, cacheFile: path.join(fake.dataDir, "tools.json") });
  assert.equal(down.registered().length, TOOLS.length, "from the list the other kept, before the server answers");
  await assert.rejects(down.registered()[0].execute("c", {}, undefined), /^Error: Godot is not running\. The person can start it in Settings → Godot\.$/);
});

test("once the server is removed, nothing is offered or registered, and its list is gone", async () => {
  const { fake, tools } = setup();
  tools.setInstalled(true);
  await tools.refresh();
  assert.equal(statSync(path.join(fake.dataDir, "tools.json")).mode & 0o777, 0o600);
  tools.forget();
  assert.deepEqual(fake.listed(), []);
  assert.deepEqual(fake.registered(), []);
  assert.throws(() => statSync(path.join(fake.dataDir, "tools.json")), /ENOENT/);
});
