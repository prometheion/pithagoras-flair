import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, TextureLoader, Timer, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMLookAtBoneApplier, type VRMLookAtExpressionApplier } from "@pixiv/three-vrm";
import type { AvatarLevels, AvatarMode } from "@pithagoras/extension-api";
import type { Model } from "./model";
import { createMotion, damp, type Bone, type Pose } from "./motion";
import { portal } from "./portal";

/**
 * A VRM model drawn with three.js and three-vrm: what the live avatar (Avatar.tsx) and the portrait the Settings page
 * makes of a model (`makePortrait`) are drawn with.
 *
 * What is shown, as the live avatar says it: the model `loading` (fetched, read and its shaders compiled, none of it
 * on a frame), `drawn`, its drawing context `lost` (a phone takes it from a page in the background, and may give it
 * back), `failed` (a file that cannot be fetched or read), or `unsupported` (no WebGL 2, which three.js has needed
 * since r163).
 */
export type Shown = "loading" | "drawn" | "lost" | "failed" | "unsupported";

/** The canvas is larger than the box by 3/14 of the box on each side, as the orb's is, so the model is not cut at its edge. */
const OVERSCAN = 10 / 7;
/** From this size of the box up, in CSS pixels, a bust is drawn; below, the face. */
const BUST_FROM = 160;

/**
 * Where the camera is and what it looks at, from the head bone's height: a bust, or the face. The bust is the one
 * 1.6 m in front drawn in the box itself: the camera is as much further back as the canvas is larger than the box, so
 * the head the box would cut is drawn whole above it.
 */
type Framing = { y: number; z: number; at: number };
const bust = (head: number): Framing => ({ y: head - 0.05, z: 1.6 * OVERSCAN, at: head - 0.12 });
const face = (head: number): Framing => ({ y: head + 0.02, z: 0.75, at: head + 0.02 });

/** The lights, as the model is drawn in both: one from above in front, and a little all round. */
function lit(): { scene: Scene; camera: PerspectiveCamera } {
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, Math.PI);
  sun.position.set(0.5, 1.5, 2);
  scene.add(sun, new AmbientLight(0xffffff, 0.4));
  const camera = new PerspectiveCamera(22, 1, 0.1, 20);
  scene.add(camera);
  return { scene, camera };
}

const at = new Vector3();

/**
 * Where the eyes look, set before `vrm.update`: at the camera, and from there `gaze` to the viewer's right and up, as
 * a share of how far the model's eyes turn (motion.ts). three-vrm turns the angle to what the eyes look at into the
 * eyes' own angle by the model's range maps, which commonly give the eyes' furthest (10° of an eye bone, or a look
 * expression at its full) only for a target a quarter turn (90°) aside: a point a little away from the camera would
 * not move the eyes visibly. So the angle to the camera is added to in the maps' own terms, the share of their
 * `inputMaxValue`, and each model's eyes go as far as its own maps take them. The head is where it was last drawn,
 * a frame ago.
 *
 * Its applier is one of the two kinds three-vrm's loader makes, a bone one or an expression one, which both have the maps.
 */
export function aim(vrm: VRM, camera: PerspectiveCamera, [right, up]: [number, number]) {
  const eyes = vrm.lookAt;
  if (!eyes) return;
  eyes.lookAt(camera.getWorldPosition(at));
  const maps = eyes.applier as VRMLookAtBoneApplier | VRMLookAtExpressionApplier;
  // Positive yaw is to the model's left, the viewer's right; negative pitch is up.
  eyes.yaw += right * maps.rangeMapHorizontalOuter.inputMaxValue;
  eyes.pitch -= up * (up > 0 ? maps.rangeMapVerticalUp : maps.rangeMapVerticalDown).inputMaxValue;
}

/**
 * A model's file, fetched and read, ready to be posed: three-vrm's clean-ups for drawing, a VRM 0.x model turned to
 * face the camera as a VRM 1.0 one does, and nothing culled, since a bone moves a mesh out of the box it was measured in.
 *
 * Its pictures are read through an `<img>` (TextureLoader), as GLTFLoader itself reads them on Safari before 17. Its
 * own way elsewhere, ImageBitmapLoader, fetch()es each picture of the file from a blob: address, which the portal's
 * Content-Security-Policy does not allow (its connect-src has no blob:, its img-src has): the model would be drawn
 * without them, white.
 */
async function loadModel(model: Model, signal: AbortSignal): Promise<VRM> {
  const answer = await fetch(portal.api.url(`/models/${model.id}/file`), { signal });
  if (!answer.ok) throw new Error(`The model's file could not be fetched (HTTP ${answer.status})`);
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.textureLoader = new TextureLoader(parser.options.manager);
    return { name: "flair_texture_loader" };
  });
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(await answer.arrayBuffer(), "");
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    VRMUtils.deepDispose(gltf.scene);
    throw new Error("three-vrm read no VRM model from the file");
  }
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  return vrm;
}

/** A pose on the model: its expressions, the angles of the bones it has (optional ones it lacks are skipped). */
function pose(vrm: VRM, { expressions, bones }: Pose) {
  for (const [name, value] of Object.entries(expressions)) vrm.expressionManager?.setValue(name, value);
  for (const [name, [x, y, z]] of Object.entries(bones)) vrm.humanoid.getNormalizedBoneNode(name as Bone)?.rotation.set(x, y, z);
}

/** The model at rest, arms down, eyes open and mouth shut, as both start: and the height of its head bone then. */
function rest(vrm: VRM): number {
  pose(vrm, createMotion(() => 0.5).step({ mode: "idle", output: 0, dt: 0, reduced: true }));
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  return vrm.humanoid.getRawBoneNode("head")!.getWorldPosition(new Vector3()).y;
}

function look(camera: PerspectiveCamera, { y, z, at }: Framing) {
  camera.position.set(0, y, z);
  camera.lookAt(0, at, 0);
  camera.updateMatrixWorld(true);
}

/**
 * Draws `model` in `host`, which fills the avatar's box, until what this returns is called. The box changes size
 * without the stage being made again (380 pixels in the middle of voice mode's stage, 64 in its dock on a phone, its
 * width animated as it moves): its size is followed with a ResizeObserver and applied in the frame, and the camera eases
 * from a bust to the face as the box crosses 160 pixels. The frame rate is the display's, at most 60, from 160 pixels
 * up, 30 below and 15 when the system asks for less motion, and nothing is drawn while the box is out of view.
 *
 * `mode` and `levels` are read in each frame, never kept. `shown` is told what is shown as it changes.
 */
export function createStage(host: HTMLElement, { model, levels, mode, shown }: {
  model: Model;
  levels: { readonly current: AvatarLevels };
  mode: () => AvatarMode;
  shown: (shown: Shown) => void;
}): () => void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    shown("unsupported");
    return () => {};
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const canvas = renderer.domElement;
  const gl = renderer.getContext();
  host.appendChild(canvas);
  const { scene, camera } = lit();
  const motion = createMotion();
  const timer = new Timer();
  // A page in the background piles up no time to catch up on.
  timer.connect(document);
  const loading = new AbortController();

  let vrm: VRM | undefined;
  let head = 0;
  let now: Shown = "loading";
  const say = (next: Shown) => {
    now = next;
    shown(next);
  };
  // The box's latest size above zero (a pane that is hidden, a dialog that is opening, have none), and the one drawn at.
  let size = 0;
  let drawnAt = 0;
  let framing: Framing | undefined;
  let last = 0;
  let seen = true;

  const frame = (time: number) => {
    // Kept under the rate for its size: a frame of the display's is let go until it is time.
    const cap = reduced ? 15 : size < BUST_FROM ? 30 : 60;
    if (time - last < 1000 / cap - 2) return;
    const gap = time - last;
    last = time;
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 1 / 15);
    if (!vrm || !size) return;
    if (size !== drawnAt) {
      renderer.setSize(size * OVERSCAN, size * OVERSCAN, false);
      drawnAt = size;
      host.dataset.framing = size < BUST_FROM ? "face" : "bust";
    }
    const goal = size < BUST_FROM ? face(head) : bust(head);
    framing = framing
      ? { y: damp(framing.y, goal.y, 6, dt), z: damp(framing.z, goal.z, 6, dt), at: damp(framing.at, goal.at, 6, dt) }
      : goal;
    // Hair and clothes would jump after a pause (the box out of view): they start again from where they hang.
    if (gap > 500) vrm.springBoneManager?.reset();
    const moved = motion.step({ mode: mode(), output: levels.current.output, dt, reduced });
    look(camera, { ...framing, z: framing.z * (1 - moved.near) });
    pose(vrm, moved);
    aim(vrm, camera, moved.gaze);
    vrm.update(dt);
    renderer.render(scene, camera);
    // The first frame, and the first once a lost context is given back: three.js draws nothing while it is lost.
    if (now !== "drawn" && !gl.isContextLost()) say("drawn");
  };
  const run = () => renderer.setAnimationLoop(seen && vrm ? frame : null);

  const resized = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) size = entry.contentRect.width;
  });
  resized.observe(host);
  const visible = new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting;
    run();
  });
  visible.observe(host);

  // three.js asks the browser to give the context back (preventDefault), and uploads it all again once it is.
  const lost = () => say("lost");
  canvas.addEventListener("webglcontextlost", lost);

  void (async () => {
    try {
      const loaded = await loadModel(model, loading.signal);
      if (loading.signal.aborted) return VRMUtils.deepDispose(loaded.scene);
      head = rest(loaded);
      scene.add(loaded.scene);
      vrm = loaded;
      look(camera, bust(head));
      // Every shader compiled now, off the frames: the first frame would stall the page otherwise.
      await renderer.compileAsync(scene, camera);
      if (!loading.signal.aborted) run();
    } catch (e) {
      if (loading.signal.aborted) return;
      console.warn(`3D Avatar: ${model.name} could not be drawn`, e);
      say("failed");
    }
  })();

  return () => {
    canvas.removeEventListener("webglcontextlost", lost);
    loading.abort();
    renderer.setAnimationLoop(null);
    resized.disconnect();
    visible.disconnect();
    timer.dispose();
    if (vrm) VRMUtils.deepDispose(vrm.scene);
    renderer.dispose();
    // Gives the context back at once, not when the canvas is collected: a page has only so many.
    renderer.forceContextLoss();
    canvas.remove();
  };
}

/**
 * A picture of a model, for a `still` avatar: 256 pixels square, framed as the face is in a small box (and so over the
 * same overscanned square), at rest with its eyes open, its mouth shut and looking at the camera. Made once, by the
 * Settings page, with a drawing context of its own that is given back at once.
 */
export async function makePortrait(model: Model): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(256, 256, false);
  let vrm: VRM | undefined;
  try {
    const { scene, camera } = lit();
    vrm = await loadModel(model, new AbortController().signal);
    const head = rest(vrm);
    look(camera, face(head));
    scene.add(vrm.scene);
    aim(vrm, camera, [0, 0]);
    vrm.update(0);
    renderer.render(scene, camera);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("The portrait could not be made"))), "image/png"));
  } finally {
    if (vrm) VRMUtils.deepDispose(vrm.scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
