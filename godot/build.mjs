/**
 * Builds the Godot extension: its browser half (src/client.tsx) into web/, with the Tailwind utilities its components
 * use made into its own stylesheet from the portal's preset, and its server half (src/server.ts) into server.js, with
 * the repository's shared server modules (../shared) bundled into it, so the published package needs nothing beside
 * it. What it makes is not kept in git; `npm pack` and `npm publish` build first (prepack).
 */
import { buildExtension } from "@pithagoras/extension-api/build";

await buildExtension({ dir: import.meta.dirname, tailwind: true, server: "src/server.ts" });
console.log("pithagoras-godot: built web/ and server.js");
