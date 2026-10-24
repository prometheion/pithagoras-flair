import { Quaternion, type Interpolant, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationHumanoidTracks, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import type { Bone } from "./motion";

/**
 * A gesture clip, a VRM Animation (`.vrma`) uploaded for a model on the Settings page, played over the motion's pose
 * (gestures.ts says when, from what time in it and by what weight).
 *
 * three-vrm-animation turns the clip's rotations of humanoid bones into the model's normalized bones' (a VRM 0.x
 * model's x and z reversed, as `pose` reverses them), so a clip made on any humanoid plays on any model. Only those
 * rotations are played: the hips are not moved from where they are (the camera frames the head where it is at rest),
 * and what the clip does to the face and the eyes is left out, as the mouth, the blink and the gaze are the motion's.
 *
 * Each frame the stage poses the bones the motion moves, and each bone the clip moves is then turned that weight of
 * the way to the clip's rotation at that time: at weight 1 the clip alone, at 0 the pose alone. A bone only the clip
 * moves (a finger, a leg, the hips) has no pose of the motion's to start from: it is put back at rest (`unpose`)
 * before each frame's pose, so it goes back as the clip fades out and stays at rest when no clip plays. No AnimationMixer:
 * the motion, not a mixer's clock, says the clip's time, and sampling each track is all it takes.
 */
export type Clip = {
  duration: number;
  /** Each bone the clip turns, with the clip's rotation of it at a time. */
  bones: { node: Object3D; sample: Interpolant }[];
  /** The bones the clip turns that the motion does not pose. */
  free: Object3D[];
};

/** The clip in a VRM Animation as read, for `vrm`: `posed` is every bone the motion poses. */
export function clipFor(animation: VRMAnimation, vrm: VRM, posed: readonly Bone[]): Clip {
  const { rotation } = createVRMAnimationHumanoidTracks(animation, vrm.humanoid, vrm.meta.metaVersion);
  const bones: Clip["bones"] = [];
  const free: Object3D[] = [];
  for (const [name, track] of rotation) {
    // Tracks are only made for bones the model has.
    const node = vrm.humanoid.getNormalizedBoneNode(name)!;
    // A quaternion track's linear interpolant slerps from key to key; the tracks three-vrm-animation makes are linear.
    bones.push({ node, sample: track.InterpolantFactoryMethodLinear() });
    if (!posed.includes(name as Bone)) free.push(node);
  }
  return { duration: animation.duration, bones, free };
}

/** A clip's file fetched from `url` and read for `vrm`. */
export async function loadClip(url: string, vrm: VRM, posed: readonly Bone[], signal: AbortSignal): Promise<Clip> {
  const answer = await fetch(url, { signal });
  if (!answer.ok) throw new Error(`The clip could not be fetched (HTTP ${answer.status})`);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.parseAsync(await answer.arrayBuffer(), "");
  const animation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0];
  if (!animation) throw new Error("three-vrm-animation read no animation from the file");
  return clipFor(animation, vrm, posed);
}

/** The bones only the clip moves, back at rest: before the frame's pose. */
export function unpose(clip: Clip) {
  for (const node of clip.free) node.quaternion.identity();
}

const at = new Quaternion();

/** The clip at `time` seconds (its last frame after its end), `weight` of the way over the pose already on the bones. */
export function playClip(clip: Clip, time: number, weight: number) {
  for (const { node, sample } of clip.bones) node.quaternion.slerp(at.fromArray(sample.evaluate(time)), weight);
}
