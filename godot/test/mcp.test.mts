import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mcpClient, Unreachable } from "../../shared/mcp.ts";
import { fakeMcp, TOOLS } from "./fakes.mts";

/** The MCP client of the server half: JSON-RPC over POST /mcp on the portal's loopback, with the server's token. */

const server = await fakeMcp("the-token");
after(() => server.close());
const mcp = mcpClient({ port: () => server.port, token: () => "the-token" });

test("every request carries the server's token, and initialize gives the server's instructions", async () => {
  const info = await mcp.initialize();
  assert.equal(info.instructions, "Tools for a real Godot 4 editor.");
  assert.equal(info.version, "4.7.2.stable");
  assert.equal(server.seen.at(-1)!.auth, "Bearer the-token");
  assert.equal(server.seen.at(-1)!.params.protocolVersion, "2025-06-18");
  assert.deepEqual((await mcp.listTools()).map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(await mcp.ping(), true);
});

test("a wrong token is said, and is no answer to ping", async () => {
  const wrong = mcpClient({ port: () => server.port, token: () => "another" });
  await assert.rejects(wrong.listTools(), /answered 401: not connected/);
  assert.equal(await wrong.ping(), false);
});

test("a JSON-RPC error is thrown with the server's message, and an answer that is not JSON is an error", async () => {
  server.answers.set("nope", "rpc-error");
  await assert.rejects(mcp.callTool("nope", {}), /unknown tool 'nope'/);
  server.answers.set("broken", "not-json");
  await assert.rejects(mcp.callTool("broken", {}), /502 with something that is not JSON: bad gateway/);
});

test("a call's signal ends it", async () => {
  server.answers.set("forever", "hang");
  const stop = new AbortController();
  const call = mcp.callTool("forever", {}, stop.signal);
  setTimeout(() => stop.abort(), 50);
  await assert.rejects(call, (e: Error) => e.name === "AbortError" && !(e instanceof Unreachable));
});

test("nothing on the port is Unreachable, which the relay says as the server not running", async () => {
  const none = mcpClient({ port: () => 1, token: () => "t" });
  await assert.rejects(none.listTools(), Unreachable);
  assert.equal(await none.ping(), false);
});
