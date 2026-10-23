/**
 * The Godot server's tools as the extension relays them (`godot_` and the server's name for each): what the card of a
 * call says in the chat, in English (the German is in de.ts), and which of them run code, or write code the editor
 * runs. Read by both halves: the server half gives pi the label and the guard, the browser half the card's words.
 *
 * A tool the server adds later and this table does not name is still relayed, with the portal's own words for its card
 * and the guard's default for the extension's tools (outside content), until the table names it.
 */

/** Marks a text to be translated where it is shown (the chat's card), as `msg` of the browser half does. */
const msg = <T extends string>(text: T): T => text;

export const LABELS: Record<string, string> = {
  godot_ping: msg("Checking Godot"),
  godot_list_projects: msg("Listing Godot projects"),
  godot_new_project: msg("Creating a Godot project"),
  godot_open_project: msg("Opening a Godot project"),
  godot_restart_editor: msg("Restarting the Godot editor"),
  godot_list_files: msg("Listing project files"),
  godot_read_file: msg("Reading a project file"),
  godot_write_file: msg("Writing a project file"),
  godot_delete_file: msg("Deleting a project file"),
  godot_get_scene_tree: msg("Reading the scene tree"),
  godot_open_scene: msg("Opening a scene"),
  godot_new_scene: msg("Creating a scene"),
  godot_add_node: msg("Adding a node"),
  godot_set_property: msg("Setting a property"),
  godot_delete_node: msg("Deleting a node"),
  godot_attach_script: msg("Attaching a script"),
  godot_save_scene: msg("Saving the scene"),
  godot_reload: msg("Reloading files"),
  godot_run_project: msg("Running the game"),
  godot_run_scene: msg("Running a scene"),
  godot_stop: msg("Stopping the game"),
  godot_get_output: msg("Reading the editor output"),
  godot_check_scripts: msg("Checking scripts"),
  godot_screenshot: msg("Taking a screenshot in Godot"),
  godot_record: msg("Recording the game"),
  godot_export: msg("Exporting the project"),
  godot_execute_gdscript: msg("Running GDScript in the editor"),
};

/**
 * The tools whose calls run code, or write code the editor runs: a GDScript file loads as soon as it is written, a
 * `@tool` script runs in the editor, and a game is a program. Once the conversation has read a result the guard flags
 * as a likely prompt injection, the guard holds each of their calls as an upload (it asks the person first, or refuses
 * where nobody can answer), since that code reaches the network of the portal's loopback.
 */
export const RUNS_CODE = [
  "godot_write_file",
  "godot_attach_script",
  "godot_run_project",
  "godot_run_scene",
  "godot_record",
  "godot_execute_gdscript",
];
