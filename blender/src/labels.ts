/**
 * The Blender server's tools, by the server's own names (its `tools/list`, kept in server/tools.json): what a call of
 * each is labelled with in pi and on its card in the chat, in English (German in de.ts), and the guard rules every
 * call of one is the shape of. Every one of them is outside content to the guard, since what they return comes from
 * the scene and its files, which may have come from an uploaded .blend. `execute_code` runs Python with the network
 * of the portal's loopback, so once a conversation has read something that looks like a prompt injection, the guard
 * asks the person before it runs, or refuses it where nobody is there to answer (`upload`).
 */

/** Marks a text to be translated where it is shown: a label kept in a table. */
const msg = <T extends string>(text: T): T => text;

export const PREFIX = "blender";

export const LABELS: Record<string, string> = {
  ping: msg("Checking Blender"),
  get_scene_info: msg("Reading the Blender scene"),
  get_object_info: msg("Reading an object in Blender"),
  execute_code: msg("Running Python in Blender"),
  preview: msg("Previewing in Blender"),
  render: msg("Rendering in Blender"),
  export: msg("Exporting from Blender"),
  list_projects: msg("Listing Blender projects"),
  open_file: msg("Opening a Blender project"),
  save_file: msg("Saving the Blender project"),
  new_scene: msg("Starting a new Blender scene"),
};

export const ACTS: Record<string, ("upload")[]> = {
  execute_code: ["upload"],
};
