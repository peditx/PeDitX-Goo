<div align="center">

<img src="linux/src-tauri/icons/icon.png" width="112" alt="PeDitX-Goo icon">

# PeDitX-Goo

**A small animated companion that sits at the top of your screen and chats with
whatever OpenAI-compatible endpoint you point it at.**

![Linux](https://img.shields.io/badge/Linux-deb%20%2F%20rpm-16A085?logo=linux)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## Why

Every assistant wants a window of its own. PeDitX-Goo wants a **strip**: a
character that lives at the top edge, wakes when you hover it, watches your
question, and reacts — happy jump when the answer lands, red shake when the
endpoint does not. It says where it is pointed, and it never phones home.

## Connection

One field: **Base URL**. Whatever answers OpenAI's `POST /v1/chat/completions`
works.

| | |
| --- | --- |
| Local gateway | `http://127.0.0.1:20128/v1` |
| **Your router, by IP** | `http://192.168.1.1:8765/v1` |
| PeDitX-AI or a public gateway | `https://api.example.com/v1` |

- **Plain HTTP is never upgraded to HTTPS.** There is no certificate theatre and
  no hostname check — a service on `192.168.x.x` keeps working exactly as written.
- **A pasted path wins.** `/v1`, `/chat/completions` or nothing at all is
  accepted as written; `/v1` is never appended to `/v1`.
- **The key is optional.** A LAN service with no auth runs fine — the request
  then goes out with no `Authorization` header.
- **Test & fetch models** calls `GET …/models`. A list comes back, the model
  dropdown fills, and the first one is chosen if you had not picked one.

**First run:** no endpoint saved yet, so the Settings window opens itself.
Put the address in, hit *Test & fetch models*, done. It stops happening the
moment the address is saved.

## What it does

- 🫧 **A real character** — drawn frame by frame on a canvas: breathing, blinks,
  eyes that follow your cursor, a greeting on launch, 28 handcrafted sounds.
- 💬 **Island chat** — type in the strip and read the reply where you are, or
  open the full-screen window for a running conversation.
- 🔴 **It says when it failed** — a timeout or a 500 turns the character red and
  shows the reason instead of swallowing it. Connection problems come with a
  *Settings* button.
- 📎 **Drop a file on it** — the character turns into a box and swallows it; the
  bytes go to the endpoint with your next message.
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
