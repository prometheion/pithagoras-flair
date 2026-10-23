import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * An extension's settings, in `settings.json` in its own folder (`portal.dataDir()`, which only the portal's user can
 * open), for its owner alone (0600): as Understory keeps its own, since it holds the server's token. Each is left out
 * until it is said.
 */
export interface Settings {
  /**
   * The one credential of the server in the container: made once, at random, the first time it is asked for, and
   * given to the container as its server token. The proxy and the MCP client send it as `Authorization: Bearer`; no
   * page is ever given it, and there is no password to fall back to.
   */
  token?: string;
  /**
   * The GPU chosen on the extension's page, by UUID: a UUID names the same card after a reboot or a card added beside
   * it, where the index order is the driver's. Empty, or not said, is "the card with the most free memory", chosen
   * when the container is made and kept from then on.
   */
  gpu?: string;
  /** The size of the virtual screen, for a server that has one (Godot's): "1600x900". */
  display?: string;
}

export interface Store {
  setting<K extends keyof Settings>(key: K): Settings[K];
  /** Keeps `patch` beside what was said before, the whole file put in place at once: a reader finds the old or the new. */
  put(patch: Settings): void;
  /** The server's token: the one kept, or a new one (24 random bytes, as hex) kept from now on. */
  token(): string;
}

/** Reads the settings from `dir`, as the half starts. Nothing there yet is no setting said. */
export function openStore(dir: string): Store {
  const file = path.join(dir, "settings.json");
  let kept: Settings;
  try {
    kept = JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {
    kept = {};
  }
  const put = (patch: Settings) => {
    const next = { ...kept, ...patch };
    writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    kept = next;
  };
  return {
    setting: (key) => kept[key],
    put,
    token() {
      if (!kept.token) put({ token: randomBytes(24).toString("hex") });
      return kept.token!;
    },
  };
}
