import { createHash } from "node:crypto";
import type { ContainerSpec, Docker } from "./docker-api";
import { gpuProbe, pickCard, type Probed } from "./gpu";

/**
 * The server's container, run through Docker for extensions (`pithagoras-docker`, which the extension requires), the
 * way Voice runs its own: made from the extension's image with the extension's spec, started, stopped and removed from
 * the extension's page in Settings, and looked after while the portal runs.
 *
 * Docker restarts it as it restarts Voice's, Browser's and Understory's (`RestartPolicy: unless-stopped`, which the
 * spec sets): after it exits, and as Docker starts after the host restarts, unless the person stopped it (Stop on the
 * page, or in Settings → Docker), when it stays stopped. Nothing here ever starts one the person stopped. And the
 * extension's own stop (the half stopping, which happens at every portal restart and every restart of Docker's half)
 * never stops it: a stop through Docker would count as the person's and keep it down after a reboot. So the container
 * outlives the extension when the extension is switched off or removed; its page says to Remove the server first.
 *
 * A container is made from a spec, which Docker cannot change afterwards. The spec the extension wants now (its image,
 * the card, what else the extension puts in it) is hashed into a label, `pithagoras.flair-spec`, everything but the
 * network: a container whose label differs is stale, and so is one whose network is not the portal's loopback as it is
 * now (`sharedNetwork()`: a portal run in Docker has another container id after every update). A running stale
 * container is made again at once, keeping its volume, and a stopped one at its next Start: Voice's rule, with a hash
 * in place of Voice's recipe label. The new image is downloaded first, while the old container goes on running.
 */

export const SPEC_LABEL = "pithagoras.flair-spec";

export type ServiceState = "unavailable" | "absent" | "foreign" | "downloading" | "starting" | "running" | "stopped" | "failed";

export interface ServiceStatus {
  state: ServiceState;
  /** Something is under way: a download, the container being made, or removed. The page waits while it is. */
  busy: boolean;
  /** The last line of the image's download, while there is one. */
  progress: string;
  /** What went wrong last, in Docker's words or the page's fixed sentences. */
  error: string;
  /** The end of what the container wrote (200 lines), as text. */
  logs: string;
  container: string;
  volume: string;
  /** The image the container runs, and the one the extension runs it from now. */
  image?: string;
  wanted: string;
  /** The card the container holds, as Docker was asked for it (a UUID, or an index the host's owner pinned). */
  card?: string;
  /** The container is made with another spec than the extension's now, or on another network: it is made again. */
  stale?: boolean;
  /** For `foreign`: whose it is ("" for a container nobody made through Docker for extensions). */
  owner?: string;
}

export interface Plan {
  /** The card to give the container, as Docker takes it (a UUID, or an index); none for no GPU. */
  card?: string;
  networkMode: string;
}

export interface ServiceOptions {
  docker: () => Docker;
  /** This extension's name, which its containers carry as their owner. */
  extension: string;
  log: (text: string) => void;
  container: string;
  volume: string;
  /** The GPU probe's container. */
  probe: string;
  image: string;
  /** The card the host's owner pinned the server to (`PITHAGORAS_<APP>_GPU`): a UUID or an index. */
  pinned?: string;
  /** The card chosen on the page, by UUID; "" for the one with the most free memory. */
  chosen: () => string;
  /** The container's spec for a plan: the extension's own. */
  spec: (plan: Plan) => ContainerSpec;
  /** Whether the server in the running container answers. */
  ready: () => Promise<boolean>;
  /** A run of the container answered for the first time: a new container, or the same one started again. */
  onReady?: (image: string) => Promise<unknown>;
  /**
   * Whether the container was there before the half started, as far as the extension can tell without asking Docker
   * (its cache of the server's tools): what `installed()` answers until the first look.
   */
  wasInstalled: () => boolean;
  /** The container came to be, or is gone (removed here, or by the person in Settings → Docker). */
  onInstalled?: (installed: boolean) => void;
}

type Inspected = {
  Id?: string;
  Config?: { Image?: string; Labels?: Record<string, string> | null };
  HostConfig?: { NetworkMode?: string; DeviceRequests?: { DeviceIDs?: string[] | null }[] | null };
  State?: { Running?: boolean; Restarting?: boolean; ExitCode?: number; StartedAt?: string; Error?: string };
};

/** The hash of a spec, as its label carries it: everything of it but the network, which is checked on its own. */
export function specHash(spec: ContainerSpec): string {
  const { HostConfig, Labels, ...rest } = spec as ContainerSpec & { HostConfig?: Record<string, unknown>; Labels?: Record<string, string> };
  const { NetworkMode: _network, ...host } = HostConfig ?? {};
  const { [SPEC_LABEL]: _own, ...labels } = Labels ?? {};
  return createHash("sha256").update(JSON.stringify({ ...rest, Labels: labels, HostConfig: host })).digest("hex").slice(0, 16);
}

/** The spec with its hash in its label. */
export function labelled(spec: ContainerSpec): ContainerSpec {
  const labels = { ...((spec.Labels as Record<string, string> | undefined) ?? {}) };
  return { ...spec, Labels: { ...labels, [SPEC_LABEL]: specHash(spec) } };
}

/** The card a container was made with, as Docker was asked for it; none for one made without a GPU. */
export const heldCard = (found: Inspected | undefined): string | undefined => found?.HostConfig?.DeviceRequests?.flatMap((r) => r.DeviceIDs ?? [])[0];

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Docker's answer that there is no such container or volume, which is no failure where nothing has to be there. */
function absent(e: unknown): void {
  if ((e as { status?: number }).status !== 404) throw e;
}

export function service(options: ServiceOptions) {
  const { docker } = options;
  const gpus = gpuProbe({ docker, name: options.probe, pinned: options.pinned });
  let pending = false;
  let phase: "downloading" | "making" | "removing" | undefined;
  let progress = "";
  let error = "";
  /** Whether the container is there, as the last look found; before the first look, `wasInstalled()`. */
  let installed: boolean | undefined;
  /** The run of the container (its id and when it started) that last answered, so each run is told once (`onReady`). */
  let answered = "";

  const setInstalled = (now: boolean) => {
    const was = installed ?? options.wasInstalled();
    installed = now;
    if (was !== now) options.onInstalled?.(now);
  };

  /** The card the container is to have: the pinned one, else the one chosen on the page, else the one it holds. */
  const wantedCard = (held: string | undefined) => options.pinned || options.chosen() || held;

  const isStale = (found: Inspected, networkMode: string) =>
    found.HostConfig?.NetworkMode !== networkMode || found.Config?.Labels?.[SPEC_LABEL] !== specHash(options.spec({ card: wantedCard(heldCard(found)), networkMode }));

  /** The container, where it is this extension's; a `Foreign` error for one by that name that is someone else's. */
  async function inspect(): Promise<Inspected | undefined> {
    const d = docker();
    const found = await d.containers.get(options.container);
    if (!found) return undefined;
    if (found.owner !== options.extension) throw new Foreign(options.container, found.owner);
    return (await d.containers.inspect(options.container)) as Inspected | undefined;
  }

  async function status(): Promise<ServiceStatus> {
    const d = docker();
    const base = { busy: pending, progress: pending ? progress : "", error, logs: "", container: options.container, volume: options.volume, wanted: options.image };
    if (!(await d.available())) return { ...base, state: "unavailable", error: error || "Docker cannot be reached." };
    let found: Inspected | undefined;
    try {
      found = await inspect();
    } catch (e) {
      if (!(e instanceof Foreign)) throw e;
      setInstalled(false);
      return { ...base, state: "foreign", owner: e.owner };
    }
    if (!found) {
      if (!pending) setInstalled(false);
      return { ...base, state: pending ? (phase === "downloading" ? "downloading" : "starting") : "absent" };
    }
    setInstalled(true);
    const logs = (await d.containers.logs(options.container, { tail: 200 }).catch((e) => (absent(e), ""))).replace(ANSI, "");
    // One Docker waits to start again is running to Docker, with nothing running in it.
    const running = found.State?.Running === true && !found.State.Restarting;
    const ready = running && (await options.ready());
    const run = `${found.Id}:${found.State?.StartedAt}`;
    if (ready && run !== answered && options.onReady) {
      answered = run;
      await options.onReady(found.Config?.Image ?? options.image).catch((e) => options.log(`could not read the server's tools: ${(e as Error).message}`));
    }
    const stale = running ? isStale(found, await d.sharedNetwork()) : false;
    // Docker starting it again by itself is a server that exited; a container that is not running and ended with a
    // code is one that failed (a stop ends the server with 0).
    const failed = !ready && (found.State?.Restarting === true || (!running && Boolean(found.State?.ExitCode)));
    const state: ServiceState = pending ? (phase === "downloading" ? "downloading" : "starting") : ready ? "running" : failed ? "failed" : running ? "starting" : "stopped";
    return { ...base, state, logs, image: found.Config?.Image, card: heldCard(found), stale, ...(failed && !error ? { error: found.State?.Error || "The server exited. Its log says why." } : {}) };
  }

  /**
   * Makes the container where there is none, or where it is stale, and starts it: in the background, with the page
   * told how it goes (`busy`, `progress`, `error`). A container that is as it should be is only started.
   */
  async function up(): Promise<void> {
    if (pending) throw new Error("Wait until what is under way is done.");
    const d = docker();
    if (!(await d.available())) throw new Error("Docker cannot be reached.");
    const found = await inspect();
    const networkMode = await d.sharedNetwork();
    if (found && !isStale(found, networkMode)) {
      await d.containers.start(options.container);
      error = "";
      return;
    }
    pending = true;
    error = "";
    progress = "";
    phase = "downloading";
    void (async () => {
      try {
        // A new container takes the card asked for, else the one it had, else (a first install) the one with the most room.
        let card = wantedCard(heldCard(found));
        if (!card && !found) card = pickCard((await gpus.probe()).cards)?.uuid;
        await d.images.ensure(options.image, (s) => {
          if (s.active && s.line !== "starting") progress = s.line;
        });
        phase = "making";
        await d.volumes.create(options.volume);
        await d.containers.create(options.container, labelled(options.spec({ card, networkMode })));
        setInstalled(true);
        await d.containers.start(options.container);
      } catch (e) {
        error = (e as Error).message;
        options.log(`could not bring up ${options.container}: ${error}`);
      } finally {
        pending = false;
        phase = undefined;
      }
    })();
  }

  return {
    status,
    install: up,
    start: up,
    async stop(): Promise<void> {
      if (pending) throw new Error("Wait until what is under way is done.");
      await docker().containers.stop(options.container);
      error = "";
    },
    /** The container goes, and with `removeData` the volume: the projects in it. The image stays (other containers may use it). */
    async uninstall(removeData: boolean): Promise<void> {
      if (pending) throw new Error("Wait until what is under way is done.");
      pending = true;
      phase = "removing";
      error = "";
      try {
        const d = docker();
        if (await inspect()) await d.containers.remove(options.container);
        setInstalled(false);
        if (removeData) await d.volumes.remove(options.volume).catch(absent);
      } finally {
        pending = false;
        phase = undefined;
      }
    },
    /**
     * What the maintain loop does every 30 s, as Voice's does: looks, which tells a run that answers for the first time
     * (`onReady`) and a container that went; and makes a running stale container again. A stopped one is left stopped.
     */
    async maintain(): Promise<void> {
      if (pending || !(await docker().available())) return;
      const seen = await status();
      if (seen.state === "running" && seen.stale) await up();
    },
    /** The cards, for the page: what the probe found, and which is pinned, chosen and held. */
    async hardware(): Promise<Probed & { pinned?: string; chosen: string; held?: string }> {
      const found = await gpus.probe();
      const held = await inspect().then(heldCard, () => undefined);
      return { ...found, pinned: options.pinned, chosen: options.chosen(), held };
    },
    /** Whether the container is there, as last seen: what the tools are offered by. Quick: no question to Docker. */
    installed: () => installed ?? options.wasInstalled(),
  };
}

export type Service = ReturnType<typeof service>;

/** A container by the server's name that is not this extension's: it is left alone. */
export class Foreign extends Error {
  constructor(
    name: string,
    readonly owner: string,
  ) {
    super(`${name} is ${owner ? `${owner}'s container` : "a container no extension made"}: rename or remove it first.`);
  }
}
