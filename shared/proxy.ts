import http from "node:http";
import type { Duplex } from "node:stream";
import type { Request, Response } from "express";

/**
 * The server's own pages, served through the portal: at /api/x/<package>/ui/, behind the portal's sign-in, so the
 * person never signs in to the server, and on the portal's own origin, so a page that needs a secure context (the
 * Godot stream decodes with WebCodecs) has the portal's. As Browser's proxy, generalised: `ui` is mounted as
 * `portal.router.use("/ui", ui)`, and `upgrade`, for a server with a WebSocket, as `portal.http.upgrade(upgrade)`.
 *
 * Upstream is the server on the portal's loopback, over plain HTTP: it shares the portal's network namespace and
 * listens on 127.0.0.1 alone.
 *
 * What goes on: the request as it came, without the portal's cookie, any credential the page sent, and where the page
 * was (`origin`, `referer`), with the server's token added. The container is not the portal, and whatever runs in it
 * (the code the agent or a project gives it) must not be handed a way into the portal.
 *
 * What is let through: any request that reads (GET, HEAD, OPTIONS), and any other only from a page of the portal
 * itself. The portal's cookie is SameSite=Lax, which a page on another port of the same address still gets sent with,
 * and these pages open projects, take uploads and run code, so a write from anywhere else is refused (403), by the
 * rule the portal holds every WebSocket to (`fromHere`, core's upgrades.ts): its Origin is the address the request was
 * made to (Host, or the first X-Forwarded-Host behind a proxy), or, with no Origin, `Sec-Fetch-Site: same-origin`.
 *
 * What comes back: what the server sent, with two more things. Only the portal's own pages may frame it
 * (`frame-ancestors 'self'`, added as a second policy beside any of the server's), and no file is taken for another
 * type than it is sent as (`nosniff`). Under /files/, where a server hands out what a project or the agent wrote,
 * the policy is also `sandbox`: such a file, opened on its own, runs no script on the portal's origin.
 */

const UI = /^\/ui(?=$|[/?])/i;
const FRAME_ANCESTORS = "frame-ancestors 'self'";

/** Is `origin` a page of the host the request was made to: Host, or the first X-Forwarded-Host? As core decides for a stream. */
export function fromHere(origin: string, headers: http.IncomingHttpHeaders): boolean {
  const forwarded = headers["x-forwarded-host"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return [headers.host, first].some((host) => !!host && sameHost(origin, host));
}

function sameHost(origin: string, host: string): boolean {
  // Only an address: anything URL would read as a user name or a path is not one.
  if (!/^[^\s/@?#\\]+$/.test(host)) return false;
  try {
    const { protocol, host: page } = new URL(origin);
    return new URL(`${protocol}//${host}`).host === page;
  } catch {
    return false;
  }
}

/** Whether a request may change something: it reads only, or it comes from a page of the portal. */
export function samePage(req: http.IncomingMessage): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.origin;
  if (origin) return fromHere(origin, req.headers);
  return req.headers["sec-fetch-site"] === "same-origin";
}

export interface ProxyOptions {
  /** The server's port on the portal's loopback. */
  port: () => number;
  token: () => string;
  /** The server's name, for what the person reads when it does not answer: "Godot". */
  app: string;
}

export function serverProxy(options: ProxyOptions) {
  const forwarded = (headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders => {
    const { cookie: _cookie, authorization: _authorization, origin: _origin, referer: _referer, host: _host, ...rest } = headers;
    return { ...rest, host: `127.0.0.1:${options.port()}`, authorization: `Bearer ${options.token()}` };
  };

  const answered = (headers: http.IncomingHttpHeaders, files: boolean): http.OutgoingHttpHeaders => {
    const own = headers["content-security-policy"];
    const ours = files ? `${FRAME_ANCESTORS}, sandbox` : FRAME_ANCESTORS;
    return { ...headers, "content-security-policy": own ? `${own}, ${ours}` : ours, "x-content-type-options": "nosniff" };
  };

  /** Every method under /ui (`portal.router.use("/ui", ui)`): Express has taken /ui off `req.url` already. */
  function ui(req: Request, res: Response): void {
    // The pages load what they need from where they are (`api/state`, `stream/`), so /ui is /ui/.
    if (/\/ui$/i.test(req.originalUrl.split("?")[0])) {
      const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      return void res.redirect(301, `ui/${query}`);
    }
    if (!samePage(req)) {
      res.status(403).json({ error: `This request did not come from the portal's own page, so it was not passed on to ${options.app}.` });
      return;
    }
    const path = req.url || "/";
    const proxied = http.request({ host: "127.0.0.1", port: options.port(), path, method: req.method, headers: forwarded(req.headers) }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, answered(upstream.headers, path.startsWith("/files/")));
      upstream.pipe(res);
    });
    proxied.on("error", () => {
      if (!res.headersSent) res.status(502).type("text/plain; charset=utf-8");
      res.end(`${options.app} antwortet nicht. / ${options.app} is not answering.`);
    });
    // A visitor who goes away takes the request with them.
    res.on("close", () => {
      if (!res.writableFinished) proxied.destroy();
    });
    req.pipe(proxied);
  }

  /**
   * The streams (`portal.http.upgrade`), handed over once the portal has checked the sign-in and that the page is the
   * portal's own. Only those under /ui are the server's. The Origin goes, as every other header the page's own: the
   * stream server under it refuses one that does not match its own host, and lets one through that has none.
   */
  function upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!UI.test(req.url ?? "")) return refuse(socket, 404, "Not Found");
    const rest = req.url!.replace(UI, "");
    const proxied = http.request({ host: "127.0.0.1", port: options.port(), path: rest.startsWith("/") ? rest : `/${rest}`, method: "GET", headers: forwarded(req.headers) });
    proxied.end();
    socket.once("close", () => proxied.destroy());
    socket.on("error", () => socket.destroy());
    proxied.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      if (socket.destroyed) return void upstreamSocket.destroy();
      const lines = Object.entries(upstreamRes.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((one) => `${k}: ${one}`) : [`${k}: ${v}`]));
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
      // Each side's first bytes go back where they were read, to be sent on to the other.
      if (upstreamHead?.length) upstreamSocket.unshift(upstreamHead);
      if (head?.length) socket.unshift(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      const close = () => {
        upstreamSocket.destroy();
        socket.destroy();
      };
      socket.on("close", close);
      upstreamSocket.on("close", close);
      socket.on("error", close);
      upstreamSocket.on("error", close);
    });
    // An answer that is not an upgrade (the server is starting, it refused): said to the page, not left waiting.
    proxied.on("response", (answer) => {
      refuse(socket, answer.statusCode ?? 502, answer.statusMessage ?? "Bad Gateway");
      answer.resume();
    });
    proxied.on("error", () => refuse(socket, 502, "Bad Gateway"));
  }

  return { ui, upgrade };
}

/**
 * An answer to a connection that is not going to become a stream, then closed, as core's: not left open for the
 * client to close, which one that never does would hold for as long as the portal runs.
 */
function refuse(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  const giveUp = setTimeout(() => socket.destroy(), 5_000);
  giveUp.unref();
  socket.once("close", () => clearTimeout(giveUp));
}
