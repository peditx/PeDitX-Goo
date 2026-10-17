<div align="center">

<img src="linux/src-tauri/icons/icon.png" width="112" alt="PeDitX-Goo icon">

# PeDitX-Goo

**PeDitX-AI's animated companion, sitting at the top of your screen.**
Same agent, same memory, same Skills — Goo is the face of it.

![Linux](https://img.shields.io/badge/Linux-deb%20%2F%20rpm-16A085?logo=linux)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## Why

**PeDitX-Goo is not an assistant.** PeDitX-AI is. Goo is its face: the
character at the top of the screen that asks the question, watches it work,
and says the answer out loud in its own body language.

Nothing is duplicated. The persona, the memory, the Skills, the access mode
and the model all belong to PeDitX-AI; Goo holds none of them and cannot
change any of them. A tool call runs under PeDitX-AI's rules, and the answer
comes back through PeDitX-AI's own prompt. Run one agent, see it in two places.

## Connection

One field: **where PeDitX-AI is listening.**

| | |
| --- | --- |
| PeDitX-AI's own default | `http://127.0.0.1:8765` |
| Another machine | `http://192.168.1.1:8765` |

That is all Goo asks for. The model endpoint, the key and the model id live in
**PeDitX-AI's Settings** — Goo reads them back only to show you what it is
about to speak as, and the key is never shown, copied or stored here.

Plain HTTP is never upgraded to HTTPS: PeDitX-AI listens on localhost, and
localhost is http.

**First run:** Goo opens Settings. Put PeDitX-AI's address in, hit *Test
connection*, done.

## What it does

- 🫧 **A real character** — drawn frame by frame on a canvas: breathing, blinks,
  eyes that follow your cursor, a greeting on launch, 28 handcrafted sounds.
- 💬 **Island chat** — type in the strip and read the reply where you are, or
  open the full-screen window for a running conversation. Both are PeDitX-AI
  answering.
- 🔧 **The agent runs, Goo narrates it** — when PeDitX-AI asks for a tool, Goo
  shows it working and waits; up to eight steps, then the final wording.
- 🔴 **It says when it failed** — PeDitX-AI not running, or a turn that did not
  land, turns the character red and shows the reason instead of swallowing it.
- 📎 **Drop a file on it** — the character turns into a box and swallows it;
  the path goes to PeDitX-AI, which reads the file itself, under its own
  access mode.
- ⌨️ **One keypress** — a global shortcut reveals the island (`Ctrl+Shift+N`,
  off by default, yours to pick).
- 🫥 **Invisible when idle** — hides away, peeks out when you hover the top edge,
  and costs nothing while hidden.
- 🔌 **Tray** — Open, Settings, Chat, Pause, Quit.

## Build

Nothing is compiled locally; CI does it.

```bash
# regenerate the assets (both are dependency-free)
npm run icons     # app + tray icons, drawn in code
npm run sounds    # the 28 WAVs, synthesised in code
```

Read-only checks before a push:

```bash
rustfmt --edition 2021 --check src-tauri/src/*.rs
npx tsc --noEmit
python3 -c "import json;json.load(open('src-tauri/tauri.conf.json'))"
```

| Tree | Runner | Artifact |
| --- | --- | --- |
| `linux/` | `ubuntu-latest` | `.deb`, `.rpm` (+ `cargo test`) |
| `windows/` | `windows-latest` | NSIS `setup.exe` + portable |

## Credits and licence

The island, the character engine, the click-through poll and the settings
machinery are a fork of **[Coucou](https://github.com/Louis-CFM/coucou)** by
Louis Raillé, used under the MIT License — see [LICENSE](LICENSE).

**The Mochi character, the Coucou icon and the Coucou sounds are not MIT** and
are not in this repository; see [LICENSE-ASSETS.md](LICENSE-ASSETS.md). PeDitX-Goo
ships its own character, its own icon and its own generated sounds — same
technique, different design. If you fork this, keep that line where it is.
