# Examplar 2026 experiment

Based on Examplar `2025` (`cbf8b0b6`), with CPO horizon history through
`dd1f375a` and the current CPO source from Pyret's monorepo at
`67e0c45081d990cbb156dff27ce527d144d4fff2` (checked September 27, 2026).
`upstream.json` pins the compiler and CodeMirror revision. Standard Pyret and
importable Spyret replace the `cnd-staging` compiler and legacy CnD renderer.

## Setup

Use Node 22.12 or newer (tested with Node 24):

```sh
npm ci --ignore-scripts
npm run setup:pyret
cd pyret
npm ci --ignore-scripts
make phaseA
cd ..
cp .env.example .env
npm run build:local
node --env-file=.env src/run.js
```

The setup script clones pinned upstream into ignored `vendor/` and creates the
`pyret` and `mode` links. To reuse an existing checkout at the pinned revision,
run `npm run setup:pyret -- /absolute/path/to/pyret-lang`. Existing checkouts
are never reset or switched.

Open `http://localhost:4999/editor` for a scratch editor without Google login.
Drive-backed assignments use `/assignment/DRIVE_FOLDER_ID` and still need
Google configuration and login.

## Drive-free Spyret

Run this with the example local configuration:

```pyret
import url("http://localhost:4999/libraries/spyret.arr") as S

data Tree:
  | leaf(value)
  | branch(left, right)
sharing:
  method _spytial(self):
    [list: S.orientation("left + right", [list: S.direction-below])]
  end
end

S.diagram(branch(leaf(1), leaf(2)))
```

For deployment, replace the origin with the deployment's HTTPS `BASE_URL`.
Examplar serves both typed rules and native code from pinned `spyret@0.2.0`.
Spyret loads pinned Spytial Core from jsDelivr when first used.

The wrapper uses the new native import internally:

```pyret
import js-http("https://your-host.example/library.js") as L
```

It takes one absolute HTTP(S) URL containing Pyret's native JavaScript module
format (`requires`, `provides`, `theModule`), not an ESM/npm entry. Cross-origin
servers need CORS. HTTP failures identify the URL and status. Normalized URLs
provide module identity for the existing CPO cache. Ordinary `url(...)` still
loads Pyret source. This loader exists in this branch, not public code.pyret.org.

Legacy `dom-render` and `_cnd` renderer hooks are removed. Use `S.diagram` and
typed `_spytial` hooks instead. The experiment uses the default Pyret-hosted
compiler; upstream's optional TypeScript compiler is outside this validation.

## Verification

```sh
npm test
CHROME_PATH=/path/to/chrome-or-chrome-headless-shell npm run test:browser
```

The browser suite starts a temporary server and tests ordinary checks, real HTTP
Spyret imports, typed hooks, images, reruns, failed imports, and assignment
evaluation. Assignment tests replace only Drive storage with fixture files;
tabs, module injection, compiler, checker and feedback remain real. Tests block
Google account traffic and research telemetry. Live OAuth, Drive sharing and
deployment need a separately configured account and environment.
