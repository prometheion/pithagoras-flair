import { useState, type ReactNode } from "react";
import type { Model } from "./model";
import { portal } from "./portal";

/**
 * A model as a picture, for a `still` avatar (an agent's card, its page): the portrait the Settings page made of it,
 * framed as the live avatar frames a face in a small box, and the portal's orb while it has none or the picture
 * cannot be loaded. No WebGL: a page of many agents uses no drawing context for them.
 */
export function Still({ model, orb }: { model: Model; orb: ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (!model.portrait || broken) return <>{orb}</>;
  return (
    <div className="flair-avatar" data-shown="drawn">
      <img
        className="flair-avatar-still"
        src={portal.api.url(`/models/${model.id}/portrait?v=${encodeURIComponent(model.portrait)}`)}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
      />
    </div>
  );
}
