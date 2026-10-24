import { useEffect, useRef, useState } from "react";
import type { AvatarProps } from "@pithagoras/extension-api";
import type { Model } from "./model";
import { withDefaults, type ModelSettings } from "./model-settings";
import { createStage, type Cue, type FramingKind, type Shown } from "./stage";

/**
 * A model drawn live where the orb is (stage.ts), in voice mode, in an agent's Avatar dialog and in this extension's
 * own preview. It fills the box it is given; the portal's orb is drawn in its place until the model is drawn, while its
 * drawing context is lost, and for good when it cannot be drawn (no WebGL 2, a file that cannot be read).
 *
 * The stage is made once for a model and the levels: a new mode reaches it through a ref, read in its frame, as the
 * levels are, so it is not made again as voice mode goes from listening to speaking. What is set on the model reaches
 * it the same way, so a change saved on the Settings page shows in the next frame, with no new drawing context; the
 * Settings page's preview gives `settings` in its place, what is being set before it is saved, and the `framing` it
 * shows. The model's gesture clips reach it the same way, and the preview's `cue`, a gesture its Try asks for.
 * `onShown` tells that preview what is shown, for it to say why the orb is.
 */
export function Avatar({ model, mode, levels, orb, onShown, settings, framing, cue }: Pick<AvatarProps, "mode" | "levels" | "orb"> & {
  model: Model;
  onShown?: (shown: Shown) => void;
  settings?: ModelSettings;
  framing?: FramingKind;
  cue?: Cue;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown>("loading");
  const now = useRef(mode);
  now.current = mode;
  const drawn = settings ?? withDefaults(model.settings);
  const set = useRef(drawn);
  set.current = drawn;
  const kind = useRef(framing);
  kind.current = framing;
  const clips = useRef(model.clips);
  clips.current = model.clips;
  const asked = useRef(cue);
  asked.current = cue;
  const tell = useRef(onShown);
  tell.current = onShown;
  useEffect(() => {
    const say = (next: Shown) => {
      setShown(next);
      tell.current?.(next);
    };
    say("loading");
    return createStage(host.current!, {
      model,
      levels,
      mode: () => now.current,
      settings: () => set.current,
      clips: () => clips.current,
      cue: () => asked.current,
      framing: () => kind.current,
      shown: say,
    });
    // The model is the same for its id: a list fetched again gives an equal one, or one with new settings or clips,
    // which the stage reads through `set` and `clips`.
  }, [model.id, levels]);
  return (
    <div className="flair-avatar" data-shown={shown}>
      <div ref={host} className="flair-avatar-gl" />
      {shown !== "drawn" && orb}
    </div>
  );
}
