# Pithagoras Flair

Cosmetic and opinionated extensions for [Pithagoras](https://github.com/thecodacus/pithagoras). These change how the portal looks and feels: things some people will love and others won't want. They are kept out of the main repository so the core stays lean.

Each extension lives in a folder of its own and is a separate package. You install the ones you want into your portal; nothing here is installed by default.

## Extensions

- [Blender](blender/README.md) (`pithagoras-blender`): a headless Blender in a container on the portal's Docker host, its tools in every chat, and its live viewport in a panel beside the chat.

In the works: a 3D avatar for voice mode, a VRM character drawn where the orb is, which blinks, breathes and lip-syncs to the agent's voice.

The extensions are npm workspaces of this repository: `npm ci` at its root installs what they are built with, `npm run build` builds each, and `npm test` runs their tests. Code their server halves share is in `shared/`, bundled into each one's `server.js`.

## Building one

An extension here is built like any Pithagoras extension, against [`@pithagoras/extension-api`](https://github.com/thecodacus/pithagoras/tree/main/packages/extension-api). See the Pithagoras docs on extensions for the browser half, the server half and the slots they can fill. Extensions here target Pithagoras 0.2.0 or later.

## License

Apache-2.0, as Pithagoras.
