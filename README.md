# Pithagoras Flair

Cosmetic and opinionated extensions for [Pithagoras](https://github.com/thecodacus/pithagoras). These change how the portal looks and feels: things some people will love and others won't want. They are kept out of the main repository so the core stays lean.

Each extension lives in a folder of its own and is a separate package. You install the ones you want into your portal; nothing here is installed by default.

## Extensions

| Extension | Folder | Install by name |
| --- | --- | --- |
| [3D Avatar](avatar/) | `avatar/` | `npm:@pithagoras/flair-avatar` |

**3D Avatar** draws an agent in voice mode as a 3D character from a VRM model, in place of the orb. You upload models on its page in Settings and choose one for each agent in its Avatar dialog; in voice mode its mouth opens with the agent's voice, it blinks, breathes and looks at you, leans in while you talk and takes a thinking pose while the agent works. Where it cannot be drawn, voice mode shows the orb. See [its README](avatar/README.md).

To install one, give its npm name in **Settings → Extensions → Discover**, once it is published. Until then, or to run one from a clone, build the repository (`npm install`, `npm run build` at its root) on the machine the portal runs on and install the extension's folder by its path.

## Building one

An extension here is built like any Pithagoras extension, against [`@pithagoras/extension-api`](https://github.com/thecodacus/pithagoras/tree/main/packages/extension-api). See the Pithagoras docs on extensions for the browser half, the server half and the slots they can fill. Extensions here need Pithagoras 0.2.1 or later; on an older portal, Settings → Extensions says which slot it does not have.

Each extension is a folder of its own and an npm workspace of this repository, published as a package of its own (`npm publish -w <folder>`). A git install cannot reach one: pi installs the whole repository from its root, and the root is an empty package (`"pi": {}`), so installing `git:github.com/thecodacus/pithagoras-flair` by mistake adds nothing and breaks nothing.

A release of the 3D Avatar is a tag, `avatar-v<version>`, matching the version in `avatar/package.json`. Its workflow (`.github/workflows/avatar-release.yml`) builds and unit-tests it, publishes the package to npm through npm's trusted publishing, with no token, and makes the GitHub release. The first version of a package is published by hand, as only a package that is there can be given a trusted publisher; the workflow's header says how.

## License

Apache-2.0, as Pithagoras.
