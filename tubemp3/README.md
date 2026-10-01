# 🎧 TUBEMP3 — YouTube Audio Liberation Terminal

A standalone tool that converts a **YouTube link** into an **audio file**
(MP3 at 64 / 128 / 192 / 320 kbps, or the native source stream), presented
inside a **hacker terminal** — CRT boot sequence, scanlines, phosphor themes,
ASCII-art thumbnails, live streamed progress with a hex noise feed, and a
working command prompt.

**It has nothing to do with the rest of this project** — brand-new, standalone
tool, WHATSL0G's visual DNA. PHP + vanilla JS, zero frontend dependencies.

---

## Quick start

1. **Start the engine** (optional but recommended): `cd Tools/tubemp3 && npm install && node server.js`
2. Open `tubemp3/index.html` in your browser (serve the folder with any PHP
   server — e.g. `php -S localhost:8098 -t Tools/tubemp3` from the project root, or
   drop it under XAMPP's htdocs).
3. Paste a YouTube link (watch, `youtu.be/`, `/shorts/`, `/embed/`) and hit
   **▶ LIBERATE** — or type `fetch <url>` at the terminal prompt.
4. Pick a quality and watch the stream come in.
5. Hit **⬇ DOWNLOAD**.

## Engines — what you get depends on what you install

The backend auto-detects its engine on every request (`status` command shows
it). Priority: **NODE → FULL → LEGACY**. Drop the binaries **next to
`api.php`** (or anywhere on PATH):

| Engine | What works | Needed for |
|---|---|---|
| **NODE** (preferred) | **MP3 at 64/128/192/320 kbps** + SOURCE, **ID3 tags with album art** embedded | `node server.js` (one command — deps install via npm, ffmpeg ships bundled) |
| `yt-dlp` + `ffmpeg` | **FULL** — MP3 at 64/128/192/320 kbps + SOURCE | both binaries |
| `yt-dlp` only | resolves + downloads, **no MP3 conversion** (SOURCE only) | `yt-dlp` |
| neither | **LEGACY** — pure-PHP extraction; only videos that expose a direct audio URL work | nothing |

### The Node engine (recommended)

```bash
cd Tools/tubemp3
npm install          # youtubei.js, fluent-ffmpeg, @ffmpeg-installer/ffmpeg, node-id3
node server.js       # listens on 127.0.0.1:8777
```

`api.php` probes it automatically — no config, no keys. The engine is
**youtubei.js** (YouTube's InnerTube API — robust signature deciphering,
the same trick modern tools use instead of the fragile ytdl-core player
scraping) with ffmpeg `libmp3lame` conversion and `node-id3` tags. A static
ffmpeg binary ships with the npm install, so MP3 conversion works out of the
box. Downloads use HTTP Range resume, so mid-transfer connection drops
recover instead of failing the job.

### YouTube bot checks ("Sign in to confirm you're not a bot")

YouTube occasionally flags an IP/network and refuses every anonymous request.
The engine now detects this, retries with a fresh session, and falls back to
yt-dlp automatically — but if the network is flagged, **logged-in cookies**
are the reliable fix:

1. Double-click **`open-cookie-profile.bat`** (in `tubemp3/`) — it opens a
   dedicated Chrome window with the tool's private profile.
2. **Log into YouTube** in that window (or let the page load).
3. **Close that window** and retry the download.

From then on the engine reads those cookies automatically (yt-dlp
`--cookies-from-browser`), and flagged networks work again. You only do this
once. The profile lives in `tubemp3/.ytprofile`.

### Fallback engines

- **yt-dlp** → `winget install yt-dlp` / `pip install yt-dlp` (Linux: `apt install yt-dlp` or the binary from github.com/yt-dlp/yt-dlp/releases)
- **ffmpeg** → `winget install ffmpeg` / `apt install ffmpeg`

Both are just executables — the tool only needs them on PATH or in the
`tubemp3/` folder. No config, no API keys.

> ⚠️ **Use legally.** Only liberate audio from videos you own or have the
> right to download. YouTube's ToS prohibit downloading; this tool is for
> personal, permitted use.

## Commands

| Command | What it does |
|---|---|
| `fetch <url>` | resolve a link → title, channel, duration, ASCII thumbnail, quality picker |
| `grab <url> [q]` | fetch + liberate immediately (q: `64` `128` `192` `320` `source`) |
| `dl <id>` | open the download for the last job of that video id |
| `jobs` | list this session's liberated files |
| `status` | engine + folder health |
| `clear` · `theme <green\|amber\|cyan\|magenta>` · `banner` | screen & vibe |
| `whoami` · `date` · `uptime` · `sudo` · `id` | easter eggs |

Bare URLs typed at the prompt behave like `fetch`. `↑`/`↓` gives command
history; clicking the terminal focuses the prompt. The **⏏ ACQUIRE** button
re-opens the paste screen anytime.

## API surface

| Endpoint | Purpose |
|---|---|
| `GET api.php?action=status` | engine detection, writable check, file count, available qualities |
| `GET api.php?action=info&url=…` | video metadata (title/channel/duration/thumb/views) via node engine, yt-dlp or legacy parser |
| `POST api.php?action=convert` (`url`, `quality`) | streams newline-delimited JSON progress: `start` → `log` / `progress` → `done`/`error` |
| `GET api.php?action=download&file=…` | force-download a liberated file from `data/out/` |

## Security notes

- URLs are validated to **YouTube hosts only**; the 11-char video ID is
  extracted and only that canonical ID is handed to the engine (no SSRF, no
  arbitrary command args).
- The engine runs via `proc_open` with an **argv array** — no shell
  interpolation.
- Downloads are confined to `data/out/` (basename + path check).
- Your link goes only to YouTube (through your server); nothing else.

## Files

```
tubemp3/
├── index.html       # the terminal UI
├── api.php          # backend: status / info / convert / download
├── assets/
│   ├── style.css    # CRT effects, themes, target card, progress
│   └── app.js       # boot, acquire, streamed progress, command shell
├── data/out/        # liberated audio (created automatically)
└── README.md
```

## Roadmap / ideas

- `history` — persist jobs to `data/history.json` across sessions
- Playlist support (`grab <playlist-url>` → batch jobs)
- Embedded ID3 tags (title/channel/art) via ffmpeg `--embed-metadata`
- Thumbnail-as-cover-art embedding (ffmpeg `--embed-thumbnail`)
