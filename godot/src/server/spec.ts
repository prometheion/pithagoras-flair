import type { ContainerSpec } from "../../../shared/docker-api";
import type { Plan } from "../../../shared/service";

/**
 * What the Godot server's container is: its image, its names, its port and the spec it is made with.
 *
 * The image is published by this repository's release workflow, built from godot/server/ (its Dockerfile), and tagged
 * with the package's version, which a test holds equal to package.json's: an update of the extension is an update of
 * the image, and the container is made again from it (service.ts, the stale rule). It is pinned by its tag, not a
 * digest: Docker for extensions splits an image's name at its last ':'.
 */
export const VERSION = "0.1.0";
export const IMAGE = `ghcr.io/thecodacus/pithagoras-godot:${VERSION}`;

/** The sizes of the virtual screen the page offers. Smaller is sharper in a panel beside a chat. */
export const DISPLAYS = ["1280x720", "1600x900", "1920x1080"] as const;
export type Display = (typeof DISPLAYS)[number];
export const DEFAULT_DISPLAY: Display = "1600x900";

/**
 * The names and the port, each as the portal's environment says it where it does: `PITHAGORAS_GODOT_CONTAINER`,
 * `_VOLUME`, `_PORT`, `_IMAGE` and `_GPU` (a card's UUID or index, which is then the only card it is given). They are
 * for a second portal on the same Docker daemon, for tests, and for a host owner who keeps it off a card.
 */
export function names(env: NodeJS.ProcessEnv = process.env) {
  const container = env.PITHAGORAS_GODOT_CONTAINER || "pithagoras-godot";
  const port = Number(env.PITHAGORAS_GODOT_PORT || 3880);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PITHAGORAS_GODOT_PORT must be a port number (1-65535).");
  return {
    container,
    volume: env.PITHAGORAS_GODOT_VOLUME || `${container}-data`,
    probe: `${container}-probe`,
    port,
    image: env.PITHAGORAS_GODOT_IMAGE || IMAGE,
    gpu: env.PITHAGORAS_GODOT_GPU || undefined,
  };
}

/**
 * The container, as the live godot-server's compose made it: an init that reaps the editor's and the games' children,
 * 1 GiB of shared memory, at most 8 GiB of memory, and no core files (a Godot crash dump is 0.3-1.3 GB). On the portal's
 * own loopback (`networkMode`, from `sharedNetwork()`), where the server listens on 127.0.0.1 alone; restarted by Docker
 * unless the person stopped it. Its projects are in a named volume at /data. The card by Docker's own request, with
 * every driver capability: graphics for Vulkan and EGL, compute, and utility for nvidia-smi. The stream is encoded on
 * the CPU (x264): NVENC wants the first GPU's device node in a container that may see only another card.
 */
export function containerSpec(plan: Plan & { image: string; token: string; port: number; display: string; volume: string }): ContainerSpec {
  return {
    Image: plan.image,
    Tty: true,
    Env: [`GODOT_SERVER_TOKEN=${plan.token}`, `GODOT_SERVER_PORT=${plan.port}`, `DISPLAY_SIZE=${plan.display}`, "NVIDIA_DRIVER_CAPABILITIES=all"],
    HostConfig: {
      NetworkMode: plan.networkMode,
      RestartPolicy: { Name: "unless-stopped" },
      Init: true,
      ShmSize: 1024 ** 3,
      Memory: 8 * 1024 ** 3,
      Ulimits: [{ Name: "core", Soft: 0, Hard: 0 }],
      Binds: [`${plan.volume}:/data`],
      DeviceRequests: plan.card ? [{ Driver: "nvidia", DeviceIDs: [plan.card], Capabilities: [["gpu"]] }] : [],
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "2" } },
    },
  };
}
