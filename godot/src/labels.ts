/**
 * The Godot server's tools, by the server's own names (its `tools/list`, kept in server/tools.json): what a call of
 * each is labelled with in pi and on its card in the chat, in English (German in de.ts), and the guard rules every
 * call of one is the shape of. Each is relayed as `godot_<name>`. Read by both halves: the server half gives pi the
 * label and the guard, the browser half the card's words.
 *
 * Every one of them is outside content to the guard, since what they return comes from projects and files that may
 * have come from anywhere.
 */

/** Marks a text to be translated where it is shown: a label kept in a table. */
const msg = <T extends string>(text: T): T => text;

export const PREFIX = "godot";

export const LABELS: Record<string, string> = {
  ping: msg("Checking Godot"),
  list_projects: msg("Listing Godot projects"),
  new_project: msg("Creating a Godot project"),
  open_project: msg("Opening a Godot project"),
  restart_editor: msg("Restarting the Godot editor"),
  list_files: msg("Listing project files"),
  read_file: msg("Reading a project file"),
  write_file: msg("Writing a project file"),
  delete_file: msg("Deleting a project file"),
  get_scene_tree: msg("Reading the scene tree"),
  open_scene: msg("Opening a scene"),
  new_scene: msg("Creating a scene"),
  add_node: msg("Adding a node"),
  set_property: msg("Setting a property"),
  delete_node: msg("Deleting a node"),
  attach_script: msg("Attaching a script"),
  save_scene: msg("Saving the scene"),
  reload: msg("Reloading files"),
  run_project: msg("Running the game"),
  run_scene: msg("Running a scene"),
  stop: msg("Stopping the game"),
  get_output: msg("Reading the editor output"),
  check_scripts: msg("Checking scripts"),
  screenshot: msg("Taking a screenshot in Godot"),
  record: msg("Recording the game"),
  export: msg("Exporting the project"),
  execute_gdscript: msg("Running GDScript in the editor"),
};

/**
 * The tools whose calls run code, or write code the editor runs: a GDScript file loads as soon as it is written, a
 * `@tool` script runs in the editor, and a game is a program. Once the conversation has read a result the guard flags
 * as a likely prompt injection, the guard holds each of their calls as an upload (it asks the person first, or refuses
 * where nobody can answer), since that code runs in the portal's network namespace (see the README on what it reaches).
 */
export const ACTS: Record<string, "upload"[]> = Object.fromEntries(
  ["write_file", "attach_script", "run_project", "run_scene", "record", "execute_gdscript"].map((name) => [name, ["upload"]]),
);
