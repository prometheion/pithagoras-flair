/**
 * Until @pithagoras/extension-api 0.2.1 is published: delete this file then.
 *
 * The `voice.avatar` slot and what its entries are drawn with, as Pithagoras 0.2.1 declares them in the package's
 * index.d.ts, copied word for word. The 0.2.0 this package builds against until then has neither; the portal it
 * runs in must have the slot (the README says which version).
 */
import type { ReactNode } from "react";

declare module "@pithagoras/extension-api" {
  /** How loud each side of a voice conversation is now, from 0 to 1: what the microphone hears, and what is played. */
  export interface AvatarLevels {
    input: number;
    output: number;
  }

  /**
   * What voice mode is doing, as an avatar shows it: the person is heard
   * (`input`); the reply is played (`output`); the agent is at work on what to
   * say and nothing is played (`thinking`, while the stage says Transcribing,
   * Thinking, Preparing your reply or Compacting context); the microphone is
   * off and nothing else is going on (`muted`); or none of these (`idle`).
   */
  export type AvatarMode = "idle" | "input" | "output" | "thinking" | "muted";

  /** What an entry of `voice.avatar` is drawn with. */
  export interface AvatarProps {
    /** The agent it is drawn for. */
    agent: { id: string; name: string };
    mode: AvatarMode;
    /**
     * The levels now. They change many times a second and the component is not
     * drawn again for them: read `levels.current.input` and
     * `levels.current.output` in an animation frame of your own. The object in
     * `current` is replaced at times, so read it through `levels` each time
     * rather than keeping it.
     */
    levels: { readonly current: AvatarLevels };
    /**
     * A picture of the agent, not voice mode: its card on the Agents page, and
     * the avatar on its page. `mode` is "idle" and the levels stay 0. Draw it
     * once and keep nothing running for it: a page can show many.
     */
    still: boolean;
    /**
     * The portal's orb for the same agent, in the same mode and with the same
     * levels: to draw while there is nothing of your own to draw yet (a model
     * still loading, a drawing context that was lost).
     */
    orb: ReactNode;
  }

  interface SlotMap {
    /**
     * The agent, drawn where voice mode draws its orb, for an agent whose
     * avatar it was chosen as. The agent's Avatar dialog lists every entry
     * beside the orb, by its `title` and `description` (translated as `title`
     * is), and what is chosen is kept as "<package>/<id>": an id kept the same
     * across versions keeps the agents that chose it, and the two together must
     * stay within 256 characters.
     *
     * It is drawn in the orb's box, which is square and changes size without
     * the component being made again (from 380 pixels in the middle of the
     * stage to 64 in its dock on a phone), and may draw past it as the orb's
     * glow does, by 3/14 of its size on each side. It is drawn too in the
     * dialog's preview, with a made-up voice, and `still` on the Agents page.
     * Where it is not in the page (its extension is not, or has not registered
     * it yet) or fails to draw, the orb is drawn in its place.
     */
    "voice.avatar": { entry: { title: string; description?: string }; props: AvatarProps };
  }
}
