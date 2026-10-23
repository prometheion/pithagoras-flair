# 3D Avatar

A [Pithagoras](https://github.com/thecodacus/pithagoras) extension that draws an agent in voice mode as a 3D character, in place of the orb. You upload VRM models on its page in Settings, and choose one for an agent in that agent's Avatar dialog. In voice mode the character's mouth opens with the agent's voice, it blinks, breathes and looks at you, leans in while you talk, and tilts its head and looks away while the agent works on its answer.

It needs Pithagoras 0.2.1 or later: that is the version with the `voice.avatar` slot. On an older portal its browser half fails to load with `There is no slot called "voice.avatar"`, and Settings → Extensions says so.

## Installing

Once it is published: **Settings → Extensions → Discover**, install `npm:@pithagoras/flair-avatar`.

From a clone of this repository, on the machine the portal runs on:

```bash
git clone https://github.com/thecodacus/pithagoras-flair.git
cd pithagoras-flair
npm install
npm run build
```

Then install the `avatar` folder's path (for example `/opt/pithagoras-flair/avatar`) by name in **Settings → Extensions**. A git address (`git:github.com/thecodacus/pithagoras-flair`) installs the repository's root, which holds no extension: each extension here is a folder of its own, published as a package of its own.

## Using it

1. **Settings → 3D Avatar → Add a model**, and pick a `.vrm` file. The page lists the model with what its file says of its own licence, shows it live in a preview with the five states voice mode has, and makes a small picture of its face for the agent's card.
2. **Agents**, open the agent, and use the palette on its avatar. Under **Shown as**, choose the model, and **Save avatar**.

Each model you add is a choice of its own in every agent's Avatar dialog, so two agents can have two characters. Deleting a model gives the agents that used it the orb again; adding the same file again brings it back for them. Wherever the model cannot be drawn (it is still loading, the browser has no WebGL 2, the file cannot be read, the drawing context was lost), voice mode shows the agent's orb.

## What it does in voice mode

| Voice mode | The character |
| --- | --- |
| Listening | breathes, sways a little, blinks every 2 to 6 seconds (now and then twice), and looks at you, its eyes moving a little from time to time |
| Hearing you | leans in towards you |
| Speaking | opens its mouth with the loudness of the voice played, fast as a syllable starts and more slowly as it ends, and nods a little with it |
| Thinking, Transcribing, Preparing your reply | once that has lasted 0.6 seconds (shorter waits are the gaps between two sentences of one reply), blinks, tilts and turns its head and looks up and aside |
| Microphone muted | as when listening |

In the middle of the stage it is drawn from the chest up, faded out towards the bottom; in the dock and in small boxes (under 160 pixels) it is the face, in a soft circle. With **reduce motion** set in the system, it neither breathes, sways nor moves its eyes on its own, leans and tilts half as far, and draws 15 frames a second; it still blinks and speaks.

## Models

VRM 1.0 and VRM 0.x models are taken, up to 64 MB. A model is refused when it is not a VRM file, lacks one of the 15 bones every VRM avatar has (hips, spine, head, both upper and lower legs, feet, upper and lower arms and hands), or is compressed with Draco, Basis or meshopt, which this extension cannot read. The models are kept in the extension's own folder in the portal's data folder, which the agents cannot reach, named by their content: the same file uploaded twice is one model.

[VRoid Studio](https://vroid.com/en/studio) makes VRM models, and [VRoid Hub](https://hub.vroid.com) has many to download, each under the terms its author set. For a phone, prefer a model whose textures are 2048 pixels or smaller: large textures can run a phone's graphics memory out.

### A model's licence is its author's

Each VRM file says under what terms it may be used: who made it, whether it may be used as an avatar by anyone, whether for profit, whether its author must be credited and whether it may be passed on. The Settings page shows exactly that, as the file says it, or "Not stated" where it says nothing. Those terms are the author's, not this extension's, and they are yours to follow: a video you make money with needs a model whose commercial use allows it.

## Phones

It draws with WebGL 2: Safari on iOS 15 and later, and Chrome on Android. Docked on a phone it is the face, at 30 frames a second. A phone takes the drawing context from a page in the background; the orb is shown until the browser gives it back. Holding the avatar to talk with push-to-talk works as with the orb: the character takes no presses.

## Size and speed

What every page loads is about 6 KB of script and 8 KB of styles. The live avatar (three.js and three-vrm) is about 770 KB, 160 KB as the portal sends it compressed, fetched the first time a live avatar is drawn; a model's file is then kept by the browser for good, since its address is its content. The model is fetched, read and its shaders compiled before the first frame, with the orb drawn meanwhile. It draws at the display's rate, at most 60 frames a second, in the middle of the stage, 30 in the dock and 15 with reduced motion, and nothing while it is out of view or the tab is hidden. The Agents page draws the pictures made in Settings, with no drawing context at all.

## Not yet

Expressions from what the reply says, and mouth shapes for the sounds spoken: the mouth follows how loud the voice is, not what it says.

## Developing

```bash
npm install          # at the repository's root
npm run build        # web/ and server.js
npm test             # unit and route tests
npx playwright install chromium
npm run test:browser # the extension on a test page of its own, in Chromium with WebGL drawn in software
```

The tests make their VRM models in code (`test/tiny-vrm.ts`). The browser tests also draw two sample models, fetched at test time into `test/.models/` from the commits they are pinned to and checked by their sha256: pixiv's `VRM1_Constraint_Twist_Sample.vrm` and VirtualCast's Seed-san, both under the [VRM Public License 1.0](https://vrm.dev/licenses/1.0/). Neither is part of this repository.

Until `@pithagoras/extension-api` 0.2.1 is published, npm finds no version for the `^0.2.1` this package names, and `npm install` stops there. Install with the one in a Pithagoras checkout of the branch that adds the slot in its place, at the repository's root: `npm install --no-save -w avatar <checkout>/packages/extension-api`.

## Licence

Apache-2.0. three.js and three-vrm, which the build bundles, are MIT: see `THIRD_PARTY_NOTICES.md`.
