import { createElement, Fragment, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from "react";
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
 *
 * What an entry draws is read from the latest list by its id, not kept from the list it was registered with: a new
 * portrait or new settings reach every avatar of the model already drawn, which draws again with them, and the live
 * one takes them in its next frame with no new drawing context. A change made on the Settings page is told to the
 * portal's other pages open in this browser (`modelsChanged`), which read the list again at once, so an avatar drawn
 * in another tab or window takes it as one on the same page does.
 */

/** What is registered for each model, by its id: under what name, and what takes it out. */
const offered = new Map<string, { name: string; drop: () => void }>();
/** The latest list, by id, and what draws from it. */
const records = new Map<string, Model>();
const listeners = new Set<() => void>();
/** Each list asked for, so an answer that comes after a later one's is not used. */
let asked = 0;
let warned = false;
let stopped = false;
/** Where the pages of the portal open in this browser say that the models changed, while the models are offered. */
let changes: BroadcastChannel | undefined;
let Live: LazyExoticComponent<typeof LiveAvatar> | undefined;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
/** A hook: the model of the latest list, the same object until a newer list is read; undefined once it is gone. */
const useModel = (id: string) => useSyncExternalStore(subscribe, () => records.get(id));

/**
 * The entry's component for a model: the picture of it for a `still` avatar, and else the model drawn live, from a
 * chunk of its own (three.js is fetched only when a live avatar is first drawn); the orb for a model no longer listed,
 * until its entry is taken out.
 */
function avatarOf(id: string): ComponentType<AvatarProps> {
  Live ??= portal.ui.lazy(() => import("./Avatar"), "Avatar");
  const Drawn = Live;
  return function ModelAvatar(props: AvatarProps) {
    const model = useModel(id);
    if (!model) return createElement(Fragment, null, props.orb);
    return props.still ? createElement(Still, { model, orb: props.orb }) : createElement(Drawn, { ...props, model });
  };
}

/**
 * Asks the server half for its models, and registers and takes out entries to match: one renamed is taken out and
 * registered again, as the portal keeps an entry as it was registered. The first list is registered as the server
 * sorts it, by name; models added later come after. Settings calls it after each change, through `modelsChanged`.
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
  // The records first, so an entry registered below draws its model at once.
  records.clear();
  for (const model of models) records.set(model.id, model);
  listeners.forEach((listener) => listener());
  for (const [id, entry] of offered) {
    if (records.get(id)?.name === entry.name) continue;
    entry.drop();
    offered.delete(id);
  }
  for (const model of models) {
    if (offered.has(model.id)) continue;
    const drop = portal.slots.register("voice.avatar", { id: model.id, title: model.name, description: msg("3D model"), component: avatarOf(model.id) });
    offered.set(model.id, { name: model.name, drop });
  }
}

/**
 * After a change made on this page (Settings): the list here read again, and the portal's other pages open in this
 * browser told to read it too. What is said is only that something changed: each page reads the list from the server.
 */
export function modelsChanged(): Promise<void> {
  changes?.postMessage("changed");
  return refreshModels();
}

/**
 * Offers the models now, again whenever another page says they changed and whenever the page is shown after being
 * hidden, until `stop`.
 */
export function offerModels(): { stop(): void } {
  stopped = false;
  const shown = () => {
    if (document.visibilityState === "visible") void refreshModels();
  };
  document.addEventListener("visibilitychange", shown);
  changes = new BroadcastChannel("@pithagoras/flair-avatar models");
  changes.onmessage = () => void refreshModels();
  void refreshModels();
  return {
    stop() {
      stopped = true;
      document.removeEventListener("visibilitychange", shown);
      changes?.close();
      changes = undefined;
      for (const entry of offered.values()) entry.drop();
      offered.clear();
    },
  };
}
