import { msg, portal } from "../portal";

/**
 * What the browser half asks of Godot's server half: its own routes, under the address the portal gives the package
 * (`portal.api.url`). A request made while the server half is not running is refused as one the server refused is.
 */

const call = async <T>(path: string, init?: RequestInit): Promise<T> => portal.api.json<T>(portal.api.url(path), init);

export type ServerState = "unavailable" | "absent" | "foreign" | "downloading" | "starting" | "running" | "stopped" | "failed";

export interface GodotState {
  state: ServerState;
  busy: boolean;
  progress: string;
  error: string;
  logs: string;
  container: string;
  volume: string;
  image?: string;
  wanted: string;
  card?: string;
  stale?: boolean;
  owner?: string;
  /** The editor, as the server says it is, while the server runs. */
  editor?: { ready: boolean; editor: string; project: string | null; renderer: string | null; busy: string | null; restarts: number; adapter: string | null; godot: string };
  display: string;
  /** The card chosen on the page ("" for automatic), and the one the host pins, if it does. */
  chosen: string;
  pinned: string;
}

export interface Card {
  index: number;
  uuid: string;
  name: string;
  usedMiB: number;
  totalMiB: number;
}

export interface Hardware {
  cards: Card[];
  error?: string;
  pinned?: string;
  chosen: string;
  held?: string;
}

/**
 * The fixed sentences the server half answers the page with, so that they are shown in the page's language: an
 * error from Docker itself is shown as Docker wrote it.
 */
export const SAID = [
  msg("Docker cannot be reached."),
  msg("Wait until what is under way is done."),
  msg("The server exited. Its log says why."),
  msg("The host pins the GPU for Godot, so it cannot be chosen here."),
  msg("Choose a GPU by its UUID, or automatic."),
  msg("That GPU is not on this host."),
  msg("Choose one of the screen sizes offered."),
];

export const api = {
  state: () => call<GodotState>("/state"),
  hardware: () => call<Hardware>("/hardware"),
  install: () => call<{ ok: true }>("/install", { method: "POST" }),
  start: () => call<{ ok: true }>("/start", { method: "POST" }),
  stop: () => call<{ ok: true }>("/stop", { method: "POST" }),
  uninstall: (removeData: boolean) => call<{ ok: true }>("/uninstall", { method: "POST", body: JSON.stringify({ removeData }) }),
  setGpu: (gpu: string) => call<{ ok: true; restarting: boolean }>("/gpu", { method: "PUT", body: JSON.stringify({ gpu }) }),
  setDisplay: (display: string) => call<{ ok: true; restarting: boolean }>("/display", { method: "PUT", body: JSON.stringify({ display }) }),
  /** The viewer, through the server half, in the page's language. */
  viewerUrl: (lang: string) => `${portal.api.url("/ui/")}?lang=${encodeURIComponent(lang)}`,
};
