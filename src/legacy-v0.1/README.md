# Legacy v0.1 UI

obsidian 0.1 shipped a hand-rolled vanilla-JS UI (CodeMirror 6 editor, custom
components). As of v0.2 the app renders the web edition's React UI unchanged
(`src/renderer/`, built by `scripts/build-web.mjs` from the web app source).

This folder keeps the old implementation for reference. It is not loaded by
`main.js` and is not required at runtime.
