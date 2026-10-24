import { AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, TextureLoader, Timer, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMLookAtBoneApplier, type VRMLookAtExpressionApplier } from "@pixiv/three-vrm";
import type { AvatarLevels, AvatarMode } from "@pithagoras/extension-api";
import type { Model } from "./model";
import { withDefaults, type ModelSettings } from "./model-settings";
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

/**
 * The version of how a model is drawn at rest in the face framing, which is what its portrait shows. Raise it with any
 * change to this module or motion.ts that changes that picture (how the file is read, the lights, the framing, the
 * rest pose, the eyes): every portrait made before then counts as old, and the Settings page makes it again.
 */
export const DRAW_VERSION = 1;

/**
 * What a portrait is drawn with, kept with it (`portraitStamp` of the model): the version of the drawing, and the
 * settings that show in it, framing, lights and the arms at rest. A string to compare, that says what it was made with.
 */
export const portraitStamp = ({ zoom, height, brightness, warmth, armDown }: ModelSettings) => `${DRAW_VERSION}:${JSON.stringify([zoom, height, brightness, warmth, armDown])}`;

/** The canvas is larger than the box by 3/14 of the box on each side, as the orb's is, so the model is not cut at its edge. */
const OVERSCAN = 10 / 7;
/** From this size of the box up, in CSS pixels, a bust is drawn; below, the face. */
const BUST_FROM = 160;

/** A bust, from the chest up, or the face: what a box of 160 pixels and more draws, and a smaller one. */
export type FramingKind = "bust" | "face";

/**
 * Where the camera is and what it looks at, from the head bone's height: a bust, or the face. The bust is the one
 * 1.6 m in front drawn in the box itself: the camera is as much further back as the canvas is larger than the box, so
 * the head the box would cut is drawn whole above it. The zoom set on the model divides the distance, and its height
 * moves the camera and what it looks at down, which draws the model higher in its box.
 */
export type Framing = { y: number; z: number; at: number };
export function framed(kind: FramingKind, head: number, { zoom, height }: ModelSettings): Framing {
  const base = kind === "bust" ? { y: head - 0.05, z: 1.6 * OVERSCAN, at: head - 0.12 } : { y: head + 0.02, z: 0.75, at: head + 0.02 };
  return { y: base.y - height, z: base.z / zoom, at: base.at - height };
}

/** The colours the lights are tinted towards, at a warmth of +1 and -1. */
export const WARM = 0xffd2a1;
export const COOL = 0xc9dcff;
const white = new Color(0xffffff);
const warm = new Color(WARM);
const cool = new Color(COOL);

/** The lights' colour for a warmth, written into `into`: white, moved that far towards the warm or the cool one. */
const tinted = (warmth: number, into: Color) => into.copy(white).lerp(warmth > 0 ? warm : cool, Math.abs(warmth));

/**
 * How the lights are set for what is set on the model: their colour (in three's working colour space) and how strong
 * the one from above in front (`sun`) and the one all round (`ambient`) are.
 */
export function lighting({ brightness, warmth }: ModelSettings): { color: [number, number, number]; sun: number; ambient: number } {
  const { r, g, b } = tinted(warmth, new Color());
  return { color: [r, g, b], sun: Math.PI * brightness, ambient: 0.4 * brightness };
}

/** `lighting`, applied to the lights themselves: in each frame, so it allocates nothing. */
function light(sun: DirectionalLight, ambient: AmbientLight, { brightness, warmth }: ModelSettings) {
  tinted(warmth, sun.color);
  ambient.color.copy(sun.color);
  sun.intensity = Math.PI * brightness;
  ambient.intensity = 0.4 * brightness;
}

/** The lights, as the model is drawn in both: one from above in front, and a little all round. */
function lit(): { scene: Scene; camera: PerspectiveCamera; sun: DirectionalLight; ambient: AmbientLight } {
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, Math.PI);
  sun.position.set(0.5, 1.5, 2);
  const ambient = new AmbientLight(0xffffff, 0.4);
  scene.add(sun, ambient);
  const camera = new PerspectiveCamera(22, 1, 0.1, 20);
  scene.add(camera);
  return { scene, camera, sun, ambient };
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

/**
 * A pose on the model: its expressions, the angles of the bones it has (optional ones it lacks are skipped).
 *
 * The angles are as on a VRM 1.0 model, which faces +z, the camera, in its own axes (motion.ts). A VRM 0.x model faces
 * -z in its own, and three-vrm's normalized bones keep the model's own axes when `rotateVRM0` turns the whole model
 * half a turn about y to face the camera: the same angles would turn its bones the other way about x and z, the arms
 * raised in place of lowered, the lean in a lean back, the nod and the tilt reversed. Half a turn about y reverses the
 * x and z of everything, the axes a bone turns about among them: a turn about x or z is, seen so, one by the opposite
 * angle, and a turn about y the same, and a bone's angles are three such turns one after the other. So a VRM 0.x model
 * is given each angle with its x and z reversed, and is posed on screen as a VRM 1.0 one is. The eyes need nothing of
 * this: three-vrm's lookAt is told which way a VRM 0.x model's face is (`faceFront`), and turns the eyes in its axes.
 */
export function pose(vrm: VRM, { expressions, bones }: Pose) {
  for (const [name, value] of Object.entries(expressions)) vrm.expressionManager?.setValue(name, value);
  const turned = vrm.meta.metaVersion === "0" ? -1 : 1;
  for (const [name, [x, y, z]] of Object.entries(bones)) vrm.humanoid.getNormalizedBoneNode(name as Bone)?.rotation.set(turned * x, y, turned * z);
}

/**
 * The model at rest, arms down by the angle set on it, eyes open and mouth shut, as both start: and the height of its
 * head bone then.
 */
export function rest(vrm: VRM, settings: ModelSettings): number {
  pose(vrm, createMotion(() => 0.5).step({ mode: "idle", output: 0, dt: 0, reduced: true, settings }));
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
 * `mode`, `levels` and `settings` (what is set on the model, model-settings.ts) are read in each frame, never kept: a
 * new zoom or height is eased to as the change of framing is, and the lights and the motion follow at once. `framing`,
 * where it says one, is drawn whatever the size (the Settings page's preview shows either). `shown` is told what is
 * shown as it changes.
 */
export function createStage(host: HTMLElement, { model, levels, mode, settings, framing: kindOf, shown }: {
  model: Model;
  levels: { readonly current: AvatarLevels };
  mode: () => AvatarMode;
  settings: () => ModelSettings;
  framing?: () => FramingKind | undefined;
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
  const { scene, camera, sun, ambient } = lit();
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
    }
    const set = settings();
    const kind = kindOf?.() ?? (size < BUST_FROM ? "face" : "bust");
    if (host.dataset.framing !== kind) host.dataset.framing = kind;
    const goal = framed(kind, head, set);
    framing = framing
      ? { y: damp(framing.y, goal.y, 6, dt), z: damp(framing.z, goal.z, 6, dt), at: damp(framing.at, goal.at, 6, dt) }
      : goal;
    // Hair and clothes would jump after a pause (the box out of view): they start again from where they hang.
    if (gap > 500) vrm.springBoneManager?.reset();
    light(sun, ambient, set);
    const moved = motion.step({ mode: mode(), output: levels.current.output, dt, reduced, settings: set });
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
      head = rest(loaded, settings());
      scene.add(loaded.scene);
      vrm = loaded;
      look(camera, framed("bust", head, settings()));
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
 * same overscanned square), at rest with its eyes open, its mouth shut and looking at the camera, with what is set on
 * the model for its framing, its lights and its arms. Made by the Settings page, with a drawing context of its own that
 * is given back at once.
 */
export async function makePortrait(model: Model): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(256, 256, false);
  let vrm: VRM | undefined;
  try {
    const set = withDefaults(model.settings);
    const { scene, camera, sun, ambient } = lit();
    light(sun, ambient, set);
    vrm = await loadModel(model, new AbortController().signal);
    const head = rest(vrm, set);
    look(camera, framed("face", head, set));
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
