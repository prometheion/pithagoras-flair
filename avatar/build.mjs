/**
 * Builds the 3D Avatar: its browser half (src/client.tsx) into web/, with the Tailwind utilities its Settings page
 * uses made into its own stylesheet from the portal's preset, and the live avatar (three.js and three-vrm) and the
 * Settings page as chunks of their own, fetched only when first drawn; and its server half (src/server.ts) into
 * server.js. `npm run build` at the repository's root runs this, and `npm pack` before it packs; what it makes is not
 * kept in git.
 */
import { buildExtension } from "@pithagoras/extension-api/build";

await buildExtension({ dir: import.meta.dirname, tailwind: true, server: "src/server.ts" });
console.log("@pithagoras/flair-avatar: built web/ and server.js");
