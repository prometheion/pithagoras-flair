import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC_LABEL, service, specHash } from "../../shared/service.ts";
import { containerSpec } from "../src/server/spec.ts";
import { fakeDocker } from "./fakes.mts";

/**
 * The server's container through Docker for extensions: installed, started, stopped and removed, made again when it is
 * stale, and never started by anything but the person.
 */

function setup(options: { pinned?: string; chosen?: string; noGpu?: string } = {}) {
  const fake = fakeDocker({ noGpu: options.noGpu });
  const settings = { chosen: options.chosen ?? "", display: "1600x900", ready: true };
  const seen = { installed: [] as boolean[], ready: [] as string[] };
  const svc = service({
    docker: () => fake.docker,
    extension: "pithagoras-godot",
    log: () => {},
    container: "pithagoras-godot",
    volume: "pithagoras-godot-data",
    probe: "pithagoras-godot-probe",
    image: "ghcr.io/thecodacus/pithagoras-godot:0.1.0",
    pinned: options.pinned,
    chosen: () => settings.chosen,
    spec: (plan) => containerSpec({ ...plan, image: "ghcr.io/thecodacus/pithagoras-godot:0.1.0", token: "t", port: 3880, display: settings.display, volume: "pithagoras-godot-data" }),
    ready: async () => settings.ready,
    onReady: async (image) => void seen.ready.push(image),
    wasInstalled: () => false,
    onInstalled: (now) => void seen.installed.push(now),
  });
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await svc.status();
      if (!s.busy) return s;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("never settled");
  };
  return { fake, svc, settings, seen, settled };
}

const kept = (fake: ReturnType<typeof fakeDocker>) => fake.containers.get("pithagoras-godot")!;

test("an install downloads the image, makes the volume, makes the container on the card with the most room, and starts it", async () => {
  const { fake, svc, seen, settled } = setup();
  assert.equal((await svc.status()).state, "absent");
  await svc.install();
  const s = await settled();
  assert.equal(s.state, "running");
  assert.equal(s.card, "GPU-bbbb1111");
  assert.deepEqual(fake.calls.filter((c) => !c.includes("probe") && c !== "pull ubuntu:24.04"), ["pull ghcr.io/thecodacus/pithagoras-godot:0.1.0", "volume pithagoras-godot-data", "create pithagoras-godot", "start pithagoras-godot"]);
  const spec = kept(fake).spec as any;
  assert.equal(spec.Labels[SPEC_LABEL], specHash(spec), "the spec's hash is in its label");
  assert.equal(spec.HostConfig.NetworkMode, "container:portal-1");
  assert.deepEqual(seen.installed, [true]);
  assert.deepEqual(seen.ready, ["ghcr.io/thecodacus/pithagoras-godot:0.1.0"], "a run that answers is told once");
  await svc.status();
  assert.equal(seen.ready.length, 1);
});

test("a card chosen on the page, or pinned by the host, is the one it is made on, with no probe", async () => {
  const chosen = setup({ chosen: "GPU-aaaa0000" });
  await chosen.svc.install();
  assert.equal((await chosen.settled()).card, "GPU-aaaa0000");
  assert.ok(!chosen.fake.calls.includes("create pithagoras-godot-probe"));
  const pinned = setup({ pinned: "1", chosen: "GPU-aaaa0000" });
  await pinned.svc.install();
  assert.equal((await pinned.settled()).card, "1", "the host's pin wins, as it names it");
});

test("with no GPU for Docker to give, the container is made without one", async () => {
  const { fake, svc, settled } = setup({ noGpu: "could not select device driver" });
  await svc.install();
  assert.equal((await settled()).state, "running");
  assert.deepEqual((kept(fake).spec as any).HostConfig.DeviceRequests, []);
});

test("a running container made with another spec is made again by the loop, keeping its volume; a stopped one waits for Start", async () => {
  const { fake, svc, settings, settled } = setup();
  await svc.install();
  await settled();
  const first = kept(fake).id;
  settings.display = "1280x720";
  assert.equal((await svc.status()).stale, true);
  await svc.maintain();
  await settled();
  assert.notEqual(kept(fake).id, first, "made again");
  assert.match((kept(fake).spec as any).Env.join(" "), /DISPLAY_SIZE=1280x720/);
  assert.equal((kept(fake).spec as any).HostConfig.DeviceRequests[0].DeviceIDs[0], "GPU-bbbb1111", "on the card it had");
  assert.ok(fake.volumes.has("pithagoras-godot-data"));
  assert.ok(!fake.calls.includes("remove volume pithagoras-godot-data"));

  await svc.stop();
  settings.display = "1920x1080";
  const before = fake.calls.length;
  await svc.maintain();
  assert.deepEqual(fake.calls.slice(before), [], "a stopped container is not made again, nor started, by the loop");
  assert.equal((await svc.status()).state, "stopped");
  await svc.start();
  assert.equal((await settled()).state, "running");
  assert.match((kept(fake).spec as any).Env.join(" "), /DISPLAY_SIZE=1920x1080/, "made again at its Start");
});

test("a container on the portal's old network is made again", async () => {
  const { fake, svc, settled } = setup();
  await svc.install();
  await settled();
  fake.state.network = "container:portal-2";
  await svc.maintain();
  await settled();
  assert.equal((kept(fake).spec as any).HostConfig.NetworkMode, "container:portal-2");
});

test("the loop never starts a container somebody stopped", async () => {
  const { fake, svc, settled } = setup();
  await svc.install();
  await settled();
  await svc.stop();
  for (let i = 0; i < 3; i++) await svc.maintain();
  assert.equal(kept(fake).running, false);
  assert.equal(fake.calls.filter((c) => c === "start pithagoras-godot").length, 1);
});

test("a container of that name that is not this extension's is left alone, and said", async () => {
  const { fake, svc } = setup();
  fake.foreign("pithagoras-godot", "someone-else");
  const s = await svc.status();
  assert.equal(s.state, "foreign");
  assert.equal(s.owner, "someone-else");
  await assert.rejects(svc.install(), /someone-else's container: rename or remove it first/);
  await assert.rejects(svc.uninstall(true), /rename or remove it first/);
  assert.ok(fake.containers.has("pithagoras-godot"));
  assert.ok(!fake.calls.some((c) => c.startsWith("create") || c.startsWith("remove")));
});

test("a server that exited, or that Docker is starting again, has failed", async () => {
  const { fake, svc, settings, settled } = setup();
  await svc.install();
  await settled();
  settings.ready = false;
  Object.assign(kept(fake), { running: false, exitCode: 1 });
  assert.equal((await svc.status()).state, "failed");
  Object.assign(kept(fake), { running: true, restarting: true });
  assert.equal((await svc.status()).state, "failed");
  Object.assign(kept(fake), { restarting: false });
  assert.equal((await svc.status()).state, "starting", "running, the server not answering yet");
  Object.assign(kept(fake), { running: false, exitCode: 0 });
  assert.equal((await svc.status()).state, "stopped");
});

test("Remove takes the container, and the projects only when asked", async () => {
  const kept = setup();
  await kept.svc.install();
  await kept.settled();
  await kept.svc.uninstall(false);
  assert.equal((await kept.svc.status()).state, "absent");
  assert.ok(kept.fake.volumes.has("pithagoras-godot-data"));
  assert.deepEqual(kept.seen.installed, [true, false]);

  const gone = setup();
  await gone.svc.install();
  await gone.settled();
  await gone.svc.uninstall(true);
  assert.ok(!gone.fake.volumes.has("pithagoras-godot-data"));
  assert.ok(!gone.fake.images.has("x"), "the image is left");
});

test("a download that fails is said, and nothing is made", async () => {
  const { fake, svc, settled } = setup();
  fake.state.pullFails = "denied: requested access to the resource is denied";
  await svc.install();
  const s = await settled();
  assert.equal(s.state, "absent");
  assert.match(s.error, /denied/);
  assert.ok(!fake.containers.has("pithagoras-godot"));
});

test("without Docker there is nothing to do, and the page is told", async () => {
  const { fake, svc } = setup();
  fake.state.available = false;
  assert.equal((await svc.status()).state, "unavailable");
  await assert.rejects(svc.install(), /Docker cannot be reached/);
});
