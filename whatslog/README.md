# 👾 WHATSL0G — Secure Chat Transmission Decoder

A standalone, self-contained tool that reads an exported **WhatsApp chat `.txt`**
file and presents it inside a **hacker terminal**: CRT boot sequence, scanlines,
phosphor glow, per-participant colors, a live command prompt, grep search, and
ASCII stats.

**It has nothing to do with the rest of this project** — it's a brand-new,
self-contained tool. Everything runs in your browser: **the chat file is parsed
100% locally and is never uploaded anywhere.** No PHP, no server, no API keys.

---

## Quick start

1. Export a chat from WhatsApp:
   - **Android:** open the chat → **⋮** → **More** → **Export chat** → *without media*.
   - **iPhone:** open the chat → contact/group name → **Export Chat** → *without media*.
   - This produces a `WhatsApp Chat with X.txt` file.
2. Open `whatslog/index.html` in any browser (works from a file path or any
   web server).
3. **Drag & drop** the `.txt` onto the screen — or click **BROWSE FILES**, or
   hit **◈ SAMPLE** to try the built-in demo chat.
4. Watch the decrypt animation, then read your chat as a terminal session.

## What it understands

| Format | Example | Status |
|---|---|---|
| US 12-hour (`M/D/YY, h:mm:ss AM/PM`) | `[2/23/24, 4:54:06 PM] Alice: hi` | ✅ |
| EU 24-hour (`DD/MM/YYYY, HH:mm:ss`) | `[23/02/2024, 16:54:06] Alice: hi` | ✅ |
| Dash variant (no brackets) | `9/30/25, 10:05 PM - Alice: hi` | ✅ |
| Narrow no-break space in time | `10:05\u202FPM` (typical iOS export) | ✅ |
| Multiline messages | continuation lines without a timestamp | ✅ indented |
| System messages | no `Name:` prefix (e.g. encryption notice) | ✅ `::` style |
| Media markers | `<Media omitted>`, `<image omitted>`, `<attachments: …>` | ✅ `[ MEDIA OMITTED ]` |
| Edited messages | `<This message was edited>` inline suffix | ✅ tagged `<edited>` |

Date order (`MM/DD` vs `DD/MM`) is auto-detected from the file itself — a value
over 12 must be the day, so it's resolved even for mixed exports. Two-digit
years are interpreted as 20xx (19xx for values above 70).

## Commands

Type at the `root@w4log:~$` prompt:

| Command | What it does |
|---|---|
| `help` | list available commands |
| `stats` | full analysis: totals, timespan, busiest hour, top transmitters with ASCII bars |
| `grep <term>` / `search <term>` | filter the transcript and highlight matches |
| `user <name>` | show only one participant's messages |
| `all` | clear filters, show everything |
| `clear` | clear the screen |
| `theme <name>` | switch phosphor: `green` · `amber` · `cyan` · `magenta` |
| `demo` | load the built-in sample chat |
| `export` | download the parsed chat as `whatslog_export.json` |
| `banner` | reprint the ASCII banner |
| `whoami` · `date` · `uptime` · `sudo` · `id` | easter eggs |

Other niceties: `↑`/`↓` for command history, click anywhere to focus the
prompt, a live clock in the status bar, and a fake "cracking the E2E layer"
progress animation on every load.

## Files

```
whatslog/
├── index.html       # the terminal UI
├── assets/
│   ├── style.css    # CRT effects, scanlines, themes, dropzone
│   └── app.js       # parser + renderer + command shell
└── README.md
```

## Privacy

No network requests, no analytics, no storage. The `.txt` file is read with a
local `FileReader` and parsed in-memory. Close the tab and it's gone.

## Roadmap / ideas

- Export transcripts as a "hacker-style" plain-text log
- `timeline` command — density sparkline per day
- word-cloud / top-words command
- theme-aware participant color wheel
