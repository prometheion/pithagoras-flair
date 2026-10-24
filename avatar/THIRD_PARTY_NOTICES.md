# Third-party notices

The 3D Avatar itself is licensed under the Apache License 2.0 (see `LICENSE`).

Its live avatar is drawn with code from two other projects, which `npm run build` bundles into `web/chunks/`: the chunk the portal fetches when a live avatar is first drawn, which the Settings page also uses to make a portrait. They stay under their own licences, given in full below; the bundle keeps their own notices too, at the end of that chunk.

## three.js

three 0.186.1 (https://threejs.org, https://github.com/mrdoob/three.js): the renderer, and the glTF loader from its examples (`three/examples/jsm/loaders/GLTFLoader.js`). Licensed under the MIT License.

    The MIT License

    Copyright © 2010-2026 three.js authors

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

## three-vrm

The npm packages `@pixiv/three-vrm`, `@pixiv/three-vrm-core`, `@pixiv/three-vrm-materials-mtoon`, `@pixiv/three-vrm-materials-v0compat`, `@pixiv/three-vrm-materials-hdr-emissive-multiplier`, `@pixiv/three-vrm-node-constraint`, `@pixiv/three-vrm-springbone`, `@pixiv/three-vrm-animation`, all 3.5.5, from pixiv's three-vrm (https://github.com/pixiv/three-vrm): what reads a VRM model and moves its expressions, its eyes, its bones and its spring bones, and what reads a VRM Animation clip. Licensed under the MIT License; each of the packages carries the same text.

    Copyright (c) 2019-2026 pixiv Inc.

    MIT License

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
    LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
    OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
    WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Models

No model is part of this package. A model someone uploads stays under its own licence, which its file states and the Settings page shows.
