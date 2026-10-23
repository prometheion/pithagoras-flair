import { useEffect, useRef, useState } from "react";
import type { AvatarProps } from "@pithagoras/extension-api";
import type { Model } from "./model";
import { createStage, type Shown } from "./stage";

/**
 * A model drawn live where the orb is (stage.ts), in voice mode, in an agent's Avatar dialog and in this extension's
 * own preview. It fills the box it is given; the portal's orb is drawn in its place until the model is drawn, while its
 * drawing context is lost, and for good when it cannot be drawn (no WebGL 2, a file that cannot be read).
 *
 * The stage is made once for a model and the levels: a new mode reaches it through a ref, read in its frame, as the
 * levels are, so it is not made again as voice mode goes from listening to speaking. `onShown` tells this
 * extension's own preview what is shown, for it to say why the orb is.
 */
export function Avatar({ model, mode, levels, orb, onShown }: Pick<AvatarProps, "mode" | "levels" | "orb"> & { model: Model; onShown?: (shown: Shown) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown>("loading");
  const now = useRef(mode);
  now.current = mode;
  const tell = useRef(onShown);
  tell.current = onShown;
  useEffect(() => {
    const say = (next: Shown) => {
      setShown(next);
      tell.current?.(next);
    };
    say("loading");
    return createStage(host.current!, { model, levels, mode: () => now.current, shown: say });
    // The model is the same for its id: a list fetched again gives an equal one.
  }, [model.id, levels]);
  return (
    <div className="flair-avatar" data-shown={shown}>
      <div ref={host} className="flair-avatar-gl" />
      {shown !== "drawn" && orb}
    </div>
  );
}
