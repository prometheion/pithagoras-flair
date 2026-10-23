import { createElement, type ComponentType, type LazyExoticComponent } from "react";
import type { AvatarProps } from "@pithagoras/extension-api";
import type { Avatar as LiveAvatar } from "./Avatar";
import type { Model } from "./model";
import { msg, portal } from "./portal";
import { Still } from "./Still";

/**
 * One `voice.avatar` entry for each model the server half has, kept in step with its list: an agent's Avatar dialog
 * lists the models beside the orb, so choosing a model for an agent is choosing that entry, and nothing about agents
 * is kept here. An entry's id is its model's: a renamed model is registered again under the same id, and the agents
 * that chose it keep it; a deleted one is taken out, and those agents show the orb.
 */

/** What is registered for each model, by its id: under what name and portrait, and what takes it out. */
const offered = new Map<string, { signature: string; drop: () => void }>();
/** Each list asked for, so an answer that comes after a later one's is not used. */
let asked = 0;
let warned = false;
let stopped = false;
let Live: LazyExoticComponent<typeof LiveAvatar> | undefined;

const signature = (model: Model) => `${model.name}|${model.portrait ?? ""}`;

/**
 * The entry's component for a model: the picture of it for a `still` avatar, and else the model drawn live, from a
 * chunk of its own (three.js is fetched only when a live avatar is first drawn).
 */
function avatarOf(model: Model): ComponentType<AvatarProps> {
  Live ??= portal.ui.lazy(() => import("./Avatar"), "Avatar");
  const Drawn = Live;
  return function ModelAvatar(props: AvatarProps) {
    return props.still ? createElement(Still, { model, orb: props.orb }) : createElement(Drawn, { ...props, model });
  };
}

/**
 * Asks the server half for its models, and registers and takes out entries to match: one whose name or portrait
 * changed is taken out and registered again, as the portal keeps an entry as it was registered. The first list is
 * registered as the server sorts it, by name; models added later come after. Settings calls this after each change.
 */
export async function refreshModels(): Promise<void> {
  const mine = ++asked;
  let models: Model[];
  try {
    models = (await portal.api.json<{ models: Model[] }>(portal.api.url("/models"))).models;
  } catch (e) {
    // Its server half is not running (Settings → Extensions says why), or the portal could not be reached.
    if (!warned) console.warn("3D Avatar: the models could not be listed, so none is offered as an avatar", e);
    warned = true;
    return;
  }
  if (mine !== asked || stopped) return;
  for (const [id, entry] of offered) {
    const model = models.find((m) => m.id === id);
    if (model && signature(model) === entry.signature) continue;
    entry.drop();
    offered.delete(id);
  }
  for (const model of models) {
    if (offered.has(model.id)) continue;
    const drop = portal.slots.register("voice.avatar", { id: model.id, title: model.name, description: msg("3D model"), component: avatarOf(model) });
    offered.set(model.id, { signature: signature(model), drop });
  }
}

/** Offers the models now, again whenever the page is shown after being hidden, until `stop`. */
export function offerModels(): { stop(): void } {
  stopped = false;
  const shown = () => {
    if (document.visibilityState === "visible") void refreshModels();
  };
  document.addEventListener("visibilitychange", shown);
  void refreshModels();
  return {
    stop() {
      stopped = true;
      document.removeEventListener("visibilitychange", shown);
      for (const entry of offered.values()) entry.drop();
      offered.clear();
    },
  };
}
