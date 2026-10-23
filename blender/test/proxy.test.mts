import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { proxyUi, uiUpgrade } from "../../shared/proxy.ts";
import { fakePortal } from "./fakes.mts";

/** The server's pages through the portal: what goes on to the server, what comes back, and what is refused. */

/** The server behind the proxy: what it was asked, kept, and an answer as a test says. */
async function upstream() {
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const answer = { status: 200, headers: { "content-type": "text/html" } as http.OutgoingHttpHeaders, body: "<p>viewer</p>" };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    });
  });
  // A WebSocket that answers what it is sent, back; or, for /refuse, an answer that is not an upgrade.
  server.on("upgrade", (req, socket) => {
    seen.push({ method: "UPGRADE", url: req.url!, headers: req.headers, body: "" });
    if (req.url === "/refuse") return void socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d: Buffer) => socket.write(Buffer.from(`echo:${d.toString("utf8")}`)));
    // As a server does when the other side has gone.
    socket.on("end", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  return { seen, answer, port: (server.address() as AddressInfo).port };
}

async function setup() {
  const up = await upstream();
  const fake = fakePortal();
  const options = { port: () => up.port, token: () => "tok", notAnswering: "Blender antwortet nicht. / Blender is not answering." };
  fake.portal.router.use("/ui", proxyUi(options));
  fake.portal.http.upgrade(uiUpgrade(options));
  const at = await fake.serve();
  return { up, at, host: new URL(at).host };
}

test("what goes on to the server: no cookie, credential, origin or referer of the page's, and the server's token", async () => {
  const { up, at, host } = await setup();
  const answer = await fetch(`${at}/ui/api/state?x=1`, { headers: { cookie: "portal_session=abc", authorization: "Basic eA==", referer: `http://${host}/s/1`, "x-kept": "yes" } });
  assert.equal(answer.status, 200);
  const asked = up.seen.at(-1)!;
  assert.equal(asked.url, "/api/state?x=1");
  assert.equal(asked.headers.cookie, undefined);
  assert.equal(asked.headers.referer, undefined);
  assert.equal(asked.headers.origin, undefined);
  assert.equal(asked.headers.authorization, "Bearer tok");
  assert.equal(asked.headers.host, `127.0.0.1:${up.port}`);
  assert.equal(asked.headers["x-kept"], "yes");
});

test("what comes back may be framed only by the portal's pages, is taken as its type, sets no cookie, and a file runs nothing", async () => {
  const { up, at } = await setup();
  let answer = await fetch(`${at}/ui/`);
  assert.equal(await answer.text(), "<p>viewer</p>");
  assert.equal(answer.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(answer.headers.get("x-content-type-options"), "nosniff");
  up.answer.headers = { "content-type": "image/png", "content-security-policy": "default-src 'self'", "set-cookie": "portal_session=forged; Path=/" };
  answer = await fetch(`${at}/ui/files/renders/a.png`);
  assert.equal(answer.headers.get("content-security-policy"), "default-src 'self', frame-ancestors 'self', sandbox");
  assert.equal(answer.headers.get("set-cookie"), null, "no cookie is set on the portal's origin");
});

test("a change from another site is refused; one from the portal's own pages goes through, with its body", async () => {
  const { up, at, host } = await setup();
  const post = (headers: Record<string, string>) => fetch(`${at}/ui/api/project`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: '{"action":"save"}' });
  assert.equal((await post({ origin: "http://evil.example" })).status, 403);
  assert.equal((await post({ origin: `http://${host.replace("127.0.0.1", "localhost")}` })).status, 403, "another name of the machine is another site");
  assert.equal((await post({})).status, 403, "no Origin and no Sec-Fetch-Site");
  assert.equal((await post({ "sec-fetch-site": "cross-site" })).status, 403);
  const before = up.seen.length;
  assert.equal((await post({ origin: `http://${host}` })).status, 200);
  assert.equal((await post({ "sec-fetch-site": "same-origin" })).status, 200);
  assert.equal((await post({ origin: "https://portal.example", "x-forwarded-host": "portal.example, inner" })).status, 200, "behind a reverse proxy");
  assert.equal(up.seen.length, before + 3);
  assert.equal(up.seen.at(-1)!.body, '{"action":"save"}');
});

test("/ui without its slash goes to ui/, with its query", async () => {
  const { at } = await setup();
  const answer = await fetch(`${at}/ui?lang=de`, { redirect: "manual" });
  assert.equal(answer.status, 302);
  assert.equal(answer.headers.get("location"), "ui/?lang=de");
});

test("a server that does not answer is said to", async () => {
  const fake = fakePortal();
  fake.portal.router.use("/ui", proxyUi({ port: () => 1, token: () => "tok", notAnswering: "Blender antwortet nicht. / Blender is not answering." }));
  const at = await fake.serve();
  const answer = await fetch(`${at}/ui/`);
  assert.equal(answer.status, 502);
  assert.equal(await answer.text(), "Blender antwortet nicht. / Blender is not answering.");
});

/** Opens a WebSocket's handshake through the proxy, as a browser would, and gives back the socket or the refusal. */
function openStream(at: string, path: string, headers: Record<string, string>): Promise<{ socket?: import("node:net").Socket; status?: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${at}${path}`, { headers: { connection: "Upgrade", upgrade: "websocket", ...headers } });
    req.on("upgrade", (_res, socket) => resolve({ socket }));
    req.on("response", (res) => resolve({ status: res.statusCode }));
    req.on("error", reject);
    req.end();
  });
}

test("a stream under /ui is piped both ways, without the page's Origin and cookie, with the token", async () => {
  const { up, at, host } = await setup();
  const { socket } = await openStream(at, "/ui/stream/websocket", { origin: `http://${host}`, cookie: "portal_session=abc" });
  assert.ok(socket);
  const echoed = new Promise<string>((resolve) => socket!.once("data", (d: Buffer) => resolve(d.toString("utf8"))));
  socket!.write("hello");
  assert.equal(await echoed, "echo:hello");
  socket!.destroy();
  const asked = up.seen.find((s) => s.method === "UPGRADE")!;
  assert.equal(asked.url, "/stream/websocket");
  assert.equal(asked.headers.origin, undefined);
  assert.equal(asked.headers.cookie, undefined);
  assert.equal(asked.headers.authorization, "Bearer tok");
});

test("a stream the server will not take is refused with its status, and one outside /ui is not the server's", async () => {
  const { at } = await setup();
  assert.equal((await openStream(at, "/ui/refuse", {})).status, 503);
  assert.equal((await openStream(at, "/other", {})).status, 404);
});
