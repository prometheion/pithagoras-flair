import { setTimeout as delay } from "node:timers/promises";
import type { Docker } from "./docker-api";

/**
 * The GPUs Docker can give a container, read in a short-lived container of their own: the portal may run in a
 * container without nvidia-smi, and the host listing a card is not Docker having a runtime for it. As Voice's probe,
 * without its fitting of engines to cards: a server here takes one card, or none.
 *
 * The probe container (`<container>-probe`, shown in Settings → Docker while it runs) is made from ubuntu:24.04, the
 * base the servers' images are built from, so it costs no download of its own once a server is installed. It asks
 * Docker for every GPU, or only for the one the host's owner pinned, and runs nvidia-smi, which the NVIDIA Container
 * Toolkit puts into it (`NVIDIA_DRIVER_CAPABILITIES=utility`). Docker refusing to start a container that asks for a GPU
 * (no NVIDIA runtime, no driver, a pinned card that is not there) is the answer "no GPU here", with Docker's words.
 *
 * It also says where the OptiX denoiser's nvoptix.bin is, for a server that denoises with it: put into the container
 * by the toolkit ("toolkit"), only on the host ("host": the server's container has to bind it), or nowhere ("none").
 * The host's /usr/share is bound read-only for that test, because it is there on every Linux host: binding
 * /usr/share/nvidia itself would make that folder on a host that lacks it (`Binds`), or refuse to start (`Mounts`).
 */

export const PROBE_IMAGE = "ubuntu:24.04";

/** A card as nvidia-smi lists it, its memory in MiB. */
export interface Card {
  index: number;
  uuid: string;
  name: string;
  usedMiB: number;
  totalMiB: number;
}

export type Optix = "toolkit" | "host" | "none";

/** What the probe found. `error`: why it lists no card, in Docker's or nvidia-smi's own words. */
export interface Probed {
  cards: Card[];
  optix: Optix;
  error?: string;
}

const QUERY = "--query-gpu=index,uuid,name,memory.used,memory.total --format=csv,noheader,nounits";
/** What runs in the probe: the cards, then the two places nvoptix.bin can be. Its own exit code is nvidia-smi's. */
const SCRIPT = [
  `nvidia-smi ${QUERY}; code=$?`,
  "test -f /usr/share/nvidia/nvoptix.bin && echo OPTIX=toolkit",
  "test -f /host-share/nvidia/nvoptix.bin && echo OPTIX=host",
  "exit $code",
].join("\n");

/**
 * What the probe printed, a card a line (`0, GPU-…, NVIDIA GeForce RTX 3060, 158, 12288`), then the OptiX lines. A
 * line of another shape is skipped. A name with a comma in it keeps it: the UUID is the second field and the memory
 * figures the last two.
 */
export function parseProbe(text: string): { cards: Card[]; optix: Optix } {
  const cards: Card[] = [];
  let toolkit = false;
  let host = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "OPTIX=toolkit") toolkit = true;
    else if (line === "OPTIX=host") host = true;
    const fields = line.split(",").map((f) => f.trim());
    if (fields.length < 5 || !/^\d+$/.test(fields[0]) || !fields[1].startsWith("GPU-")) continue;
    const used = fields.at(-2)!;
    const total = fields.at(-1)!;
    if (!/^\d+$/.test(used) || !/^\d+$/.test(total)) continue;
    cards.push({ index: Number(fields[0]), uuid: fields[1], name: fields.slice(2, -2).join(", "), usedMiB: Number(used), totalMiB: Number(total) });
  }
  return { cards, optix: toolkit ? "toolkit" : host ? "host" : "none" };
}

/** The card a new container is given: the one chosen by its UUID where it is listed, else the one with the most free memory. */
export function pickCard(cards: readonly Card[], chosen?: string): Card | undefined {
  const asked = chosen ? cards.find((c) => c.uuid === chosen) : undefined;
  if (asked) return asked;
  return [...cards].sort((a, b) => b.totalMiB - b.usedMiB - (a.totalMiB - a.usedMiB))[0];
}

type Inspected = { State?: { Running?: boolean; ExitCode?: number } };

/**
 * The probe for one server: `name` is its probe container's, `pinned` the card the host's owner pinned it to (a UUID
 * or an index), which is then the only one it asks for and lists. One probe at a time: the Settings page asks as it
 * opens, and an install asks when no card is chosen; a second asker waits for the probe that runs.
 */
export function gpuProbe(options: { docker: () => Docker; name: string; pinned?: string }) {
  let probing: Promise<Probed> | undefined;

  async function run(): Promise<Probed> {
    const d = options.docker();
    await d.images.ensure(PROBE_IMAGE);
    const asked = options.pinned ? { DeviceIDs: [options.pinned] } : { Count: -1 };
    await d.containers.create(options.name, {
      Image: PROBE_IMAGE,
      Tty: true,
      Cmd: ["sh", "-c", SCRIPT],
      Env: ["NVIDIA_DRIVER_CAPABILITIES=utility"],
      HostConfig: { DeviceRequests: [{ Driver: "nvidia", ...asked, Capabilities: [["gpu"]] }], Binds: ["/usr/share:/host-share:ro"] },
    });
    try {
      try {
        await d.containers.start(options.name);
      } catch (e) {
        // Docker would not give it a GPU: there is none it can give.
        return { cards: [], optix: "none", error: (e as Error).message };
      }
      // Until it has exited: Docker's own wait is not one an extension is given.
      const ended = Date.now() + 30_000;
      let state: Inspected["State"];
      while ((state = ((await d.containers.inspect(options.name)) as Inspected | undefined)?.State)?.Running) {
        if (Date.now() > ended) throw new Error("nvidia-smi did not end in time");
        await delay(200);
      }
      const text = await d.containers.logs(options.name);
      const found = parseProbe(text);
      if (!found.cards.length) {
        const said = text.trim().split(/\r?\n/).filter((l) => !l.startsWith("OPTIX=")).at(-1);
        return { ...found, error: said || `nvidia-smi exited with ${state?.ExitCode ?? "no code"}` };
      }
      return found;
    } finally {
      await d.containers.remove(options.name).catch(() => {});
    }
  }

  return {
    probe(): Promise<Probed> {
      probing ??= run().finally(() => {
        probing = undefined;
      });
      return probing;
    },
  };
}
