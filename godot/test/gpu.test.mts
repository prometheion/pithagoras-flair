import { test } from "node:test";
import assert from "node:assert/strict";
import { gpuProbe, parseProbe, pickCard } from "../../shared/gpu.ts";
import { fakeDocker } from "./fakes.mts";

/** The GPUs as the probe container reads them: its output, the card a server is given, and the probe's own life. */

test("the probe's output: a card a line, a name with a comma kept, and where nvoptix.bin is", () => {
  const found = parseProbe("0, GPU-aaaa, NVIDIA GeForce RTX 3060, 11000, 12288\r\n1, GPU-bbbb, Quadro, Max-Q, 158, 8192\r\nNo devices were found\r\nOPTIX=host\r\n");
  assert.deepEqual(found.cards, [
    { index: 0, uuid: "GPU-aaaa", name: "NVIDIA GeForce RTX 3060", usedMiB: 11000, totalMiB: 12288 },
    { index: 1, uuid: "GPU-bbbb", name: "Quadro, Max-Q", usedMiB: 158, totalMiB: 8192 },
  ]);
  assert.equal(found.optix, "host");
  assert.equal(parseProbe("OPTIX=toolkit\nOPTIX=host\n").optix, "toolkit", "the toolkit's own copy wins over the host's");
  assert.equal(parseProbe("").optix, "none");
});

test("a new server takes the card with the most free memory, or the one chosen", () => {
  const { cards } = parseProbe("0, GPU-aaaa, A, 11000, 12288\n1, GPU-bbbb, B, 158, 12288\n2, GPU-cccc, C, 0, 8192\n");
  assert.equal(pickCard(cards)?.uuid, "GPU-bbbb");
  assert.equal(pickCard(cards, "GPU-aaaa")?.uuid, "GPU-aaaa");
  assert.equal(pickCard(cards, "GPU-gone")?.uuid, "GPU-bbbb", "a choice that is not there is no choice");
  assert.equal(pickCard([]), undefined);
});

test("the probe asks for every GPU, reads them, and is removed", async () => {
  const fake = fakeDocker();
  const found = await gpuProbe({ docker: () => fake.docker, name: "pithagoras-godot-probe" }).probe();
  assert.deepEqual(found.cards.map((c) => c.uuid), ["GPU-aaaa0000", "GPU-bbbb1111"]);
  assert.equal(found.optix, "toolkit");
  assert.ok(fake.calls.includes("pull ubuntu:24.04"));
  assert.ok(fake.calls.includes("remove pithagoras-godot-probe"));
  assert.equal(fake.containers.size, 0);
});

test("a pinned card is the only one the probe asks Docker for", async () => {
  const fake = fakeDocker();
  let asked: any;
  const create = fake.docker.containers.create;
  fake.docker.containers.create = async (name, spec) => ((asked = spec), create(name, spec));
  await gpuProbe({ docker: () => fake.docker, name: "x-probe", pinned: "GPU-648bf6c5" }).probe();
  assert.deepEqual(asked.HostConfig.DeviceRequests, [{ Driver: "nvidia", DeviceIDs: ["GPU-648bf6c5"], Capabilities: [["gpu"]] }]);
  assert.deepEqual(asked.HostConfig.Binds, ["/usr/share:/host-share:ro"]);
  assert.deepEqual(asked.Env, ["NVIDIA_DRIVER_CAPABILITIES=utility"]);
});

test("Docker refusing the GPU is no GPU, with Docker's words, and the probe is removed all the same", async () => {
  const fake = fakeDocker({ noGpu: 'could not select device driver "nvidia" with capabilities: [[gpu]]' });
  const found = await gpuProbe({ docker: () => fake.docker, name: "x-probe" }).probe();
  assert.deepEqual(found.cards, []);
  assert.match(found.error!, /could not select device driver/);
  assert.ok(fake.calls.includes("remove x-probe"));
  assert.equal(fake.containers.size, 0);
});

test("a probe that fails part way is removed too, and one probe runs at a time", async () => {
  const fake = fakeDocker();
  fake.docker.containers.logs = async () => {
    throw new Error("Docker's answer was cut off");
  };
  const probe = gpuProbe({ docker: () => fake.docker, name: "x-probe" });
  const [a, b] = [probe.probe(), probe.probe()];
  assert.equal(a, b, "the second asker waits for the probe that runs");
  await assert.rejects(a, /cut off/);
  assert.equal(fake.containers.size, 0);
  assert.equal(fake.calls.filter((c) => c === "create x-probe").length, 1);
});
