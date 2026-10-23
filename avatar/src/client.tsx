import { Suspense } from "react";
import type { Portal } from "@pithagoras/extension-api";
import { de } from "./de";
import { offerModels } from "./models";
import { msg, portal, setPortal, t } from "./portal";
import "./client.css";

/**
 * The 3D Avatar's browser half: a VRM model drawn in voice mode where the orb is, which lip-syncs to the agent's
 * voice, blinks, breathes, looks at you, leans in while you talk and takes a thinking pose while the agent works.
 *
 * Each model uploaded on its page in Settings is offered as an avatar of its own (`voice.avatar`, models.ts), so an
 * agent's Avatar dialog lists them beside the orb and the choice of model is the agent's. What draws a model live
 * (three.js and three-vrm) and the Settings page are chunks of their own, fetched when they are first drawn: this
 * module is what every page loads. Its texts in German are in de.ts.
 */
export default function flairAvatar(given: Portal) {
  setPortal(given);
  const drop = [portal.locale.add("de", de)];
  const Settings = portal.ui.lazy(() => import("./Settings"), "Settings");
  drop.push(
    portal.slots.register("settings.page", {
      id: "settings",
      title: msg("3D Avatar"),
      icon: AvatarIcon,
      search: [{ title: msg("Models"), section: msg("Models"), words: "vrm avatar 3d model upload modell hochladen" }],
      // Settings draws an extension's page without a Suspense of its own: one fetched later would blank it until then.
      component: () => (
        <Suspense fallback={<p className="text-sm text-fg-subtle">{t("Loading…")}</p>}>
          <Settings />
        </Suspense>
      ),
    }),
  );
  const models = offerModels();
  return () => {
    models.stop();
    drop.forEach((d) => d());
  };
}

/** A head and shoulders, as Settings' list shows the extension. */
function AvatarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      <path d="M9.5 8.5c.7.6 1.5.9 2.5.9s1.8-.3 2.5-.9" />
    </svg>
  );
}
