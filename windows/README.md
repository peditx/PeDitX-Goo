# PeDitX-Goo for Windows

The Windows tree of PeDitX-Goo. What the app is, how the endpoint is configured
and how it builds are all in the [root README](../README.md); agent-facing
layout and rules are in [CLAUDE.md](../CLAUDE.md).

```bash
cd windows
npm ci
npm run dev     # Vite only, for iterating on the island in a browser
npm run icons   # regenerate windows/src-tauri/icons from scripts/gen-icons.mjs
npm run sounds  # regenerate ../sounds from ../scripts/gen-sounds.mjs
npm run pack    # tauri build, then rename the packages into release/
```

Nothing is compiled on a development machine; `windows.yml`
does it.
