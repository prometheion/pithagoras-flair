import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { specHash } from "../../shared/service.ts";
import { containerSpec, IMAGE, names, VERSION } from "../src/server/spec.ts";

/** The Godot server's container as the extension makes it: what the live godot-server's compose had, on the portal's loopback. */

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const plan = { networkMode: "container:portal-1", image: IMAGE, token: "t0k3n", port: 3880, display: "1600x900", volume: "pithagoras-godot-data" };

test("the image is the package's version, so a release cannot forget to move it", () => {
  assert.equal(VERSION, pkg.version);
  assert.equal(IMAGE, `ghcr.io/thecodacus/pithagoras-godot:${pkg.version}`);
});

test("the container: on the portal's loopback, restarted unless stopped, with its token, its port, its screen and its volume", () => {
  const spec = containerSpec({ ...plan, card: "GPU-bbbb1111" }) as any;
  assert.equal(spec.Image, IMAGE);
  assert.equal(spec.Tty, true, "plain-text logs");
  assert.deepEqual(spec.Env, ["GODOT_SERVER_TOKEN=t0k3n", "GODOT_SERVER_PORT=3880", "DISPLAY_SIZE=1600x900", "NVIDIA_DRIVER_CAPABILITIES=all"]);
  const host = spec.HostConfig;
  assert.equal(host.NetworkMode, "container:portal-1");
  assert.deepEqual(host.RestartPolicy, { Name: "unless-stopped" });
  assert.deepEqual(host.Binds, ["pithagoras-godot-data:/data"]);
  assert.deepEqual(host.DeviceRequests, [{ Driver: "nvidia", DeviceIDs: ["GPU-bbbb1111"], Capabilities: [["gpu"]] }]);
  assert.deepEqual(host.LogConfig, { Type: "json-file", Config: { "max-size": "10m", "max-file": "2" } });
  // As the live compose: init, 1 GiB of shared memory, 8 GiB of memory, no core files.
  assert.equal(host.Init, true);
  assert.equal(host.ShmSize, 1024 ** 3);
  assert.equal(host.Memory, 8 * 1024 ** 3);
  assert.deepEqual(host.Ulimits, [{ Name: "core", Soft: 0, Hard: 0 }]);
  assert.equal(host.PortBindings, undefined, "nothing is published");
});

test("without a card it asks Docker for no GPU", () => {
  assert.deepEqual((containerSpec(plan) as any).HostConfig.DeviceRequests, []);
});

test("every name comes from the portal's environment where it says one", () => {
  assert.deepEqual(names({}), { container: "pithagoras-godot", volume: "pithagoras-godot-data", probe: "pithagoras-godot-probe", port: 3880, image: IMAGE, gpu: undefined });
  const env = {
    PITHAGORAS_GODOT_CONTAINER: "flairtest-godot",
    PITHAGORAS_GODOT_VOLUME: "flairtest-godot-data",
    PITHAGORAS_GODOT_PORT: "3881",
    PITHAGORAS_GODOT_IMAGE: "flairtest-pithagoras-godot:0.1.0",
    PITHAGORAS_GODOT_GPU: "GPU-648bf6c5",
  };
  assert.deepEqual(names(env), { container: "flairtest-godot", volume: "flairtest-godot-data", probe: "flairtest-godot-probe", port: 3881, image: "flairtest-pithagoras-godot:0.1.0", gpu: "GPU-648bf6c5" });
  assert.equal(names({ PITHAGORAS_GODOT_CONTAINER: "other" }).volume, "other-data", "the volume follows the container's name");
  assert.throws(() => names({ PITHAGORAS_GODOT_PORT: "godot" }), /PITHAGORAS_GODOT_PORT/);
});

test("the spec's hash changes with the image, the card and the screen, and not with the network", () => {
  const base = specHash(containerSpec({ ...plan, card: "GPU-a" }));
  assert.notEqual(specHash(containerSpec({ ...plan, card: "GPU-a", image: "ghcr.io/thecodacus/pithagoras-godot:0.1.1" })), base);
  assert.notEqual(specHash(containerSpec({ ...plan, card: "GPU-b" })), base);
  assert.notEqual(specHash(containerSpec({ ...plan, card: undefined })), base);
  assert.notEqual(specHash(containerSpec({ ...plan, card: "GPU-a", display: "1280x720" })), base);
  assert.equal(specHash(containerSpec({ ...plan, card: "GPU-a", networkMode: "host" })), base);
});
