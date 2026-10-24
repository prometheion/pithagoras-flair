# 3D Avatar

A [Pithagoras](https://github.com/thecodacus/pithagoras) extension that draws an agent in voice mode as a 3D character, in place of the orb. You upload VRM models on its page in Settings, and choose one for an agent in that agent's Avatar dialog. In voice mode the character's mouth moves with the agent's voice through the shapes of vowels, its head and hands move on the words it stresses, it blinks, breathes and looks at you, leans in and nods while you talk, tilts its head and looks away while the agent works on its answer, waves as voice mode starts, and shifts its weight and stretches now and then while it waits.

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

1. **Settings → 3D Avatar → Add a model**, and pick one or more `.vrm` files, or drop them on the page. Each model is a card in the page's gallery, one row that scrolls sideways when there are more than fit; choose one to see it under the gallery, the page scrolled as far as it takes to show its preview: what its file says of its own licence, a live preview as voice mode draws it, with the five states voice mode has and **Talk** to play a made-up turn, and what can be set on it (below). There it can be renamed, downloaded and deleted. The page also makes a small picture of each model's face for the agent's card.
2. **Agents**, open the agent, and use the palette on its avatar. Under **Shown as**, choose the model, and **Save avatar**.

Each model you add is a choice of its own in every agent's Avatar dialog, so two agents can have two characters. Deleting a model gives the agents that used it the orb again; adding the same file again brings it back for them. Wherever the model cannot be drawn (it is still loading, the browser has no WebGL 2, the file cannot be read, the drawing context was lost), voice mode shows the agent's orb.

## Changing how a model looks and moves

Beside the preview (under it on a phone) is what can be set on the model, in six tabs: Camera, Light, Motion, Eyes, Voice and Arms. The tabs' panel is as tall as the preview whichever tab is shown, and scrolls inside when a tab has more than fits (faded at its foot then, so the rest is seen to be there), so the preview and its settings are seen together, in the Settings dialog of a 1280 by 800 screen too, and choosing a tab does not move the page. What is set is kept with the model, so every agent that has the model looks the same, and applies wherever the model is drawn (the preview, voice mode, each agent's Avatar dialog) as soon as a slider is let go, without the model being loaded again: in the portal's other tabs and windows in the same browser too, and in another browser or device the next time its page is shown. A value set apart from its default is shown in colour, and its tab has a dot. Each tab has its own reset (**Reset Camera**, **Reset Light** and so on), which puts back that tab's settings alone and turns into **Undo** until something else is changed.

| Tab | Setting | What it does | Range |
| --- | --- | --- | --- |
| Camera | Zoom | how close the camera is, in the bust and the face alike | 0.6× to 1.6× |
| | Height | moves the model up or down in its box: for a model whose head is cut off or sits low | −10 to +10 cm |
| Light | Brightness | how strongly the lights fall on it | 50% to 150% |
| | Warmth | the lights' colour, from cool blue to warm orange | cooler 100% to warmer 100% |
| Motion | Overall motion | all of its own movement at once: breathing, sway, eye movement, nodding, leaning in, the thinking pose and its gestures; it blinks and speaks either way | 0% to 150% |
| | Breathing and sway | how much its chest rises and its head sways | 0% to 200% |
| | Leaning in | how far it leans towards you while you talk | 0% to 200% |
| | Thinking pose | whether it tilts its head and looks away while the agent works on its answer | on or off |
| Eyes | Gaze | at you, its eyes moving a little now and then; or around, its eyes wandering while nothing is said and coming back when you talk or it speaks | at you, around |
| | Blinking | how often it blinks | about 8 to 30 a minute |
| Voice | Mouth sensitivity | how wide the mouth opens at the same loudness: raise it for a quiet voice | 50% to 200% |
| | Mouth shapes | whether the mouth takes a vowel's shape on each syllable, or only opens and shuts | on or off |
| Arms | Arm angle | how far the arms come down from the T-pose a VRM model is made in: change it when they go into the body or stand out stiffly | 46° to 83° |
| | Gestures | how much it moves its hands and head on the words it stresses, nods while you talk, waves as voice mode starts, puts a hand to its chin on a long think, and shifts its weight and stretches while it waits; 0% is none of them | 0% to 200% |
| | Gesture clips | a VRM Animation file for the wave and one for the hand to the chin, played in place of the built-in gesture; **Try** shows either in the preview (see [Gesture clips](#gesture-clips)) | a `.vrma` file, or built in |

With **reduce motion** set in the system, breathing, sway, eye movement and every gesture stay off and leaning in and the thinking pose are at most half as strong, whatever is set here, and the Motion tab says so. The mouth's shapes stay: they do not move the body.

The picture on the agent's card is made again on this page whenever what shows in it (zoom, height, the lights, the arm angle) changes, and once for every model after an update changes how models are drawn. The Agents page shows the last picture made until the 3D Avatar page in Settings is opened.

## What it does in voice mode

| Voice mode | The character |
| --- | --- |
| Listening | breathes, sways a little, blinks every 2 to 6 seconds (now and then twice), and looks at you, its eyes moving a little from time to time; every 5 to 12 seconds it shifts its weight to the other foot, stretches or tilts its head. The first time it waits, as voice mode starts, it waves |
| Hearing you | leans in towards you, nods now and then while you talk, and at a pause (half a second of quiet after a second or more of talk) nods or leans back a little, once; when you stop and it moves on, it nods |
| Speaking | opens its mouth with the loudness of the voice played, fast as a syllable starts and more slowly as it ends, each syllable in the shape of a vowel; holds its forearms up a little, as a speaker does, and on a stressed syllable dips its head and flicks a hand |
| Thinking, Transcribing, Preparing your reply | once that has lasted 0.6 seconds (shorter waits are the gaps between two sentences of one reply), blinks, tilts and turns its head and looks up and aside; after 2.5 seconds it puts a hand to its chin until the answer comes |
| Microphone muted | as when listening |

These are the defaults; [Changing how a model looks and moves](#changing-how-a-model-looks-and-moves) says what can be changed.

In the middle of the stage it is drawn from the chest up, faded out towards the bottom; in the dock and in small boxes (under 160 pixels) it is the face, in a soft circle. With **reduce motion** set in the system, it neither breathes, sways, moves its eyes on its own nor makes any gesture, leans and tilts half as far, and draws 15 frames a second; it still blinks and speaks.

### The mouth's shapes come from the loudness

What reaches the avatar of the agent's voice is one number, how loud it is now: the portal measures what it plays and hands the avatar that, not the sound. The vowels cannot be heard in a loudness, so the shapes are a guess that looks like speech: each syllable (where the loudness rises and falls) is given one vowel, chosen at random, more often an open one for a sharp, loud start and a rounded one for a soft one, and seldom the one before it again. A mouth shaped by the sounds actually spoken needs the portal to hand the avatar the audio, which is a change to the portal, not to this extension. **Mouth shapes** off gives the open-and-shut mouth it had before.

## Gesture clips

The wave and the hand to the chin are built in, and work with any VRM model. In their place a model can be given a [VRM Animation](https://vrm.dev/en/vrma/) clip (`.vrma`) of each, uploaded under **Gesture clips** in its Arms tab: the wave's clip plays once as voice mode starts, and the thinking clip plays from its start once the agent has thought for 2.5 seconds, holding its last frame until the answer comes. A clip is played over the rest of the motion, fading in and out, and only its turns of the body's bones are played: it does not move the model across the frame, and what it does to the face and the eyes is left to the avatar. Up to 4 MB, checked as it is uploaded. Clips are kept with the model, so every agent with the model has them; **Reset Arms** leaves them.

None comes with the extension. VRoid's free [VRM animation set](https://booth.pm/en/items/5512385) has a greeting among its seven: its terms let you use and change the motions, for profit too with a credit to pixiv's VRoid Project, but not pass them on, which is why this extension cannot ship it. Download it yourself and upload `VRMA_02` as the wave. Other clips are made with tools such as [bvh2vrma](https://vrm-c.github.io/bvh2vrma/) from BVH motion capture.

## Models

VRM 1.0 and VRM 0.x models are taken, up to 64 MB. A model is refused when it is not a VRM file, lacks one of the 15 bones every VRM avatar has (hips, spine, head, both upper and lower legs, feet, upper and lower arms and hands), is compressed with Draco, Basis or meshopt, which this extension cannot read, or loads a part of itself (a buffer or a picture) from an address outside its file: every browser that drew it would fetch that address, and tell whoever is there when the model is looked at. VRM exporters put everything in the file. The models are kept in the extension's own folder in the portal's data folder, which the agents cannot reach, named by their content: the same file uploaded twice is one model.

[VRoid Studio](https://vroid.com/en/studio) makes VRM models, and [VRoid Hub](https://hub.vroid.com) has many to download, each under the terms its author set. With no models yet, the Settings page lists a few free ones that pass and are drawn well as they are, with what their licences say. For a phone, prefer a model whose textures are 2048 pixels or smaller: large textures can run a phone's graphics memory out.

### A model's licence is its author's

Each VRM file says under what terms it may be used: who made it, whether it may be used as an avatar by anyone, whether for profit, whether its author must be credited and whether it may be passed on. The Settings page shows exactly that, as the file says it, or "Not stated" where it says nothing: whether it may be used for money, credited and passed on as three badges, and all of it under **Licence details**. Those terms are the author's, not this extension's, and they are yours to follow: a video you make money with needs a model whose commercial use allows it.

## Phones

It draws with WebGL 2: Safari on iOS 15 and later, and Chrome on Android. Docked on a phone it is the face, at 30 frames a second. A phone takes the drawing context from a page in the background; the orb is shown until the browser gives it back. Holding the avatar to talk with push-to-talk works as with the orb: the character takes no presses.

## Size and speed

What every page loads is about 12 KB of script (most of it the German texts) and 18 KB of styles. The live avatar (three.js, three-vrm and three-vrm-animation) is about 810 KB, 165 KB as the portal sends it compressed, fetched the first time a live avatar is drawn; a model's file is then kept by the browser for good, since its address is its content. The model is fetched, read and its shaders compiled before the first frame, with the orb drawn meanwhile. The motion and the gestures are a little arithmetic a frame; a clip is a few rotations sampled. It draws at the display's rate, at most 60 frames a second, in the middle of the stage, 30 in the dock and 15 with reduced motion, and nothing while it is out of view or the tab is hidden. The Agents page draws the pictures made in Settings, with no drawing context at all; the Settings page makes them again when they are out of date, one at a time.

## Not yet

Expressions from what the reply says, and mouth shapes for the sounds spoken: the mouth follows how loud the voice is, not what it says (see [The mouth's shapes come from the loudness](#the-mouths-shapes-come-from-the-loudness)). Gestures chosen from what is said, such as a shrug at a question it cannot answer: the gestures follow what voice mode is doing and how loud each side is.

## Developing

```bash
npm install          # at the repository's root
npm run build        # web/ and server.js
npm test             # unit and route tests
npx playwright install chromium
npm run test:browser # the extension on a test page of its own, in Chromium with WebGL drawn in software
```

The tests make their VRM models and a VRM Animation in code (`test/tiny-vrm.ts`, `test/tiny-vrma.ts`). The browser tests' page is served with the portal's own Content-Security-Policy, which the extension draws under in a portal. They also draw two sample models and play a sample clip, fetched at test time into `test/.models/` from the commits they are pinned to and checked by their sha256: pixiv's `VRM1_Constraint_Twist_Sample.vrm` and VirtualCast's Seed-san, both under the [VRM Public License 1.0](https://vrm.dev/licenses/1.0/), and three-vrm-animation's example clip `test.vrma`, under three-vrm's MIT License. None is part of this repository.

Until `@pithagoras/extension-api` 0.2.1 is published, this package builds against 0.2.0, which does not declare the `voice.avatar` slot: `src/voice-avatar-slot.d.ts` declares it as 0.2.1 does, and is deleted once 0.2.1 is out. Only the types come from the package; the slot itself is the portal's, so the extension still needs a portal of 0.2.1 or later.

## Licence

Apache-2.0. three.js, three-vrm and three-vrm-animation, which the build bundles, are MIT: see `THIRD_PARTY_NOTICES.md`.
