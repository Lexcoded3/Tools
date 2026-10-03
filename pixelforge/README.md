# ⚡ PixelForge — Free AI Media Studio

A standalone, self-contained AI **image & video studio** that lives inside this
project but has **nothing to do with the Attan website**. It generates images
from text prompts (free Perchance Stable Diffusion), repaints your photos with
instant local effects or real AI, renders short AI videos (Replicate), and
turns stories into narrated slideshow videos — all from one page.

**No API key for images. No signup. No watermarks.** Pure PHP + vanilla JS —
zero dependencies, runs on any plain XAMPP/PHP stack. (The only exception:
**🌀 3D mode** lazy-loads Three.js from a CDN the moment you open its tab, so
it needs internet like everything else here.)

---

## Quick start

1. Drop this folder anywhere under your web root (e.g. `htdocs/…/pixelforge`).
2. Open it in your browser:

   ```
   http://localhost/pixelforge/
   ```

   or run it with PHP's built-in server:

   ```
   php -S localhost:8099 -t pixelforge
   ```

3. Pick a mode — **🖼 Images**, **🎬 Video**, **📖 Story**, or **🌀 3D** — type a prompt,
  and hit **⚡ Forge**. The style defaults to **No style** — you can forge
  with no style applied, just your prompt. (No style still sends a neutral
  anti-anime/anatomy negative prompt automatically, so bare prompts stay
  grounded instead of drifting into anime — your own negative tokens are
  always kept.)

> **Images are free and keyless.** Only Video mode needs a
> [Replicate](https://replicate.com) API key (`r8_…`), and ✨ AI Repaint needs
> a free [HuggingFace](https://huggingface.co/settings/tokens) token (`hf_…`).
> The tool needs outbound internet access to `image-generation.perchance.org`
> and `perchance.org` (how images are made). PHP's `curl` extension is
> required — it ships enabled in standard XAMPP installs.

---

## Features

| Feature | What it does |
|---|---|
| 🎨 **Text-to-image** | Free Stable Diffusion generations via Perchance, unlimited |
| 🖼️ **Repaint (img2img)** | Upload a photo → 10 instant browser-side effects (Oil, Sketch, Watercolor, Pop Art, Pixel Art, Mosaic, Vintage, B&W, Negative, Glow) — no key needed. Or pick **🆓 Free img2img** (keyless Perchance img2img, unlimited) or **✨ AI Repaint** (real img2img via HuggingFace token) |
| 🧍 **Full body (headshot → portrait)** | Tick **Full body** in the reference panel to turn a headshot into a full portrait: the photo is anchored at the top of a 2:3 canvas with a soft neutral gradient below, and the AI outpaints the body you describe (output forced to Portrait). Free, keyless |
| 🧱 **Batch forging** | Generate **1 – 32 images** at once (1, 2, 4, 8, 16 or 32) — tiles appear one-by-one, three across |
| 📊 **Progress bar + ETA** | While a batch runs: a live gradient bar, `X / Y` counter and an estimated time-left computed from the per-image average |
| ⏹ **Stop anytime** | The Forge button becomes a red **Stop** — click it to finish the current image and skip the rest |
| 🎬 **Video mode** | Render 5s clips (16:9) via Replicate — prompt + style, playable MP4 in the grid, saved to `data/videos/` |
| 🌀 **3D mode** | Turn any photo into an animated 3D depth scene — live WebGL parallax preview (mouse/touch), 5 depth-map styles, drift / Ken Burns / ripple animations, then **render an 8s looping WebM** or **export a self-contained HTML embed** for your website. 100% in your browser, free, keyless (Three.js is lazy-loaded from a CDN only when the 3D tab is used) |
| 📖 **Story mode** | Paste a story → it's split into scenes (paragraph / sentence / chars, max 12), each scene gets an image **plus AI narration** (free Microsoft Edge neural voices, no key), then rendered into a slideshow video in your browser |
| 🔤 **Prompt enhance** | One click rewrites a bare prompt into a detailed, vivid version (free AI) |
| 🕘 **Prompt history** | Your last 12 successful prompts are remembered locally — click the prompt box to reuse or delete one |
| 🚫 **Negative presets** | One-click chips fill common negative-prompt sets (low quality, bad hands, no text, safe-only…) — toggleable, editable |
| 🔎 **Gallery search** | Filter Recent creations by prompt text as you type (count pill shows matches) |
| 💡 **Sample prompt chips** | The empty state offers 4 clickable starter prompts — one click fills the prompt box |
| 🖌️ **85+ style presets** | 73 Perchance style templates (Studio Ghibli, 1950s Photo, Manga, 3D Disney, Cute 3D Icons, maps, logos & more) plus 12 tuned core styles — default is **No style** (prompt untouched; a neutral anti-stylization negative is merged in automatically) |
| 📐 **Resolutions** | Square (768×768), Portrait (512×768), Landscape (768×512), or **Custom** W×H (256–768px in 64px steps; the free engine auto-snaps to the nearest supported size and tells you when it does) |
| 🎛️ **Guidance scale** | 1–20 slider — how closely the image follows your prompt |
| 🎲 **Seed control** | `-1` = random; a fixed seed reproduces the same image. Randomize with the 🎲 button or the **S** key |
| 🧹 **Tidy panels** | The reference-image section, **Advanced** settings (negative · seed · guidance · mature toggle) tuck into collapsible panels — the default view is just Mode · Prompt · Style · Resolution · Count · Forge |
| ⚙️ **Advanced panel** | Negative prompt, seed and guidance tuck into a collapsible panel (remembers whether you left it open); the mature-content toggle lives here too |
| 🔒 **Mature-content gating** | Flagged images are blurred with an 18+ confirm; a toggle reveals them (remembered per session/browser) |
| ⌨️ **Keyboard shortcuts** | `Ctrl+Enter` = forge · `S` = random seed · `Esc` = close · `←/→` = lightbox navigation |
| 🖼️ **Lightbox viewer** | Click any tile for a full-size view with seed/size/style/prompt info, prev/next, download, reuse seed, copy prompt, delete — plus **zoom & pan** (click to zoom, drag to pan, wheel to scale, double-click to reset) |
| 💾 **Remembers your work** | Prompt, resolution, guidance, seed, batch size and story settings survive closing the page (localStorage). Style always reopens on **No style** — pick a style per session |
| 🗂️ **History gallery** | Every image & video is saved with its prompt, seed & settings — re-view, re-download, or delete anytime |
| 📦 **Download all** | After a batch, grab the whole grid as a single ZIP (one click, one file) |
| 🗑 **Clear all history** | Wipe the entire gallery + media files from disk in one click (with confirmation) |
| 🔗 **Shareable files** | Real JPEGs and MP4s — download, print, or share in WhatsApp groups |
| 🟡 **Free-engine status** | The header pill turns **amber when the shared free service is under load** (generations may queue) and flips back to green the moment a generation succeeds — with auto re-checks every 12s while busy |

---

## How it works (for the curious)

### Images — the free Perchance path

PixelForge is a thin, honest wrapper around the free Perchance image API:

1. **Key acquisition** — `GET /api/verifyUser?browserId=…` on
   `image-generation.perchance.org` issues a temporary session access key
   *without* any CAPTCHA. That `browserId` is a stable 32-hex client id kept
   in `data/key.json`: the service binds every key to it and answers
   `client_update_required` when the request carries none (the handshake
   changed in late September 2026). The text host behaves the opposite way
   and must **not** be sent one. Keys are cached and refreshed automatically
   when stale.
2. **Generation** — `POST /api/generate` with your prompt, negative prompt,
   resolution, guidance scale and seed. If the service is busy it queues the
   request; PixelForge polls the queue until the image is ready.
3. **Download & save** — the service returns a **single-use** download URL that
   is bound to this server's IP, so it is always fetched server-side straight
   into `data/images/` and the browser only ever receives the local copy.
   Handing that URL to the browser would leave the local copy — and with it
   history, downloads and story mode — empty.

Requests are sent with browser-style headers (User-Agent, Origin, Referer) so
the service treats them like a normal browser tab — that's the only "trick".

**🔤 Prompt enhance** uses the same Perchance family (the `ai-text-plugin`
endpoint on `text-generation.perchance.org`). Its session key is cached in
`data/key.json` for an hour and verified with a short retry/backoff — never on
every click — so heavy use doesn't trip Perchance's per-IP rate limit.

> **If verification is refused** (`failed_verification` / `token_required`):
> Perchance periodically flags an IP and demands a browser Turnstile check.
> Open <https://perchance.org/ai-text-plugin> (or the image generator page)
> once in your browser and come back — the flag clears and the keyless path
> resumes automatically. VPNs often cause this; disable them.

### Video — two engines

**Free · no key** (default) — text-to-video without a card. It prefers
**Pollinations** (open-source, free key from enter.pollinations.ai — no
credit card; paste it in Video mode), and falls back to the keyless Okatsu
API (the WhatsApp bots' `.sora` engine) when no key is saved. Pick the free
engine and hit generate: the render blocks until the MP4 comes back, then
the file is validated and saved to `data/videos/` (action `video_free`).
Best-effort quality — free services can be slow or down; PixelForge then
shows a clean error telling you exactly what to do, and you can always
switch to Replicate.

**Replicate · r8 key** — GPU text-to-video via [Replicate](https://replicate.com)
with a key you paste in Video mode. PixelForge starts a prediction, polls
`video_status` until it's done, then downloads and validates the MP4 into
`data/videos/`.

### Story — images + free neural TTS

Each scene's image comes from the same free Perchance path; the narration is
synthesized with Microsoft Edge's free neural voices (server-side, cached in
`data/voices.json`). The final video is rendered in your browser on a canvas
(with optional captions) and uploaded to history via `story_upload`.

### Repaint — local, free & AI

Local repaints run entirely in your browser on a `<canvas>` (no upload, no
key). **🆓 Free img2img** sends the photo to the same keyless Perchance
service as normal generations (the `referenceImage` field) — unlimited, no
token, with the blend slider acting as match strength. **✨ AI Repaint** calls
a HuggingFace image-to-image model (`Lykon/dreamshaper-xl-1-0` by default)
using your free token. Both save the result the same way as a normal

> 💡 **How the free img2img reference gets to Perchance:** the free service
> only accepts a **public http(s) URL** in `referenceImage.url` — it silently
> ignores base64 `data:` URLs (returns success but generates without the
> photo). So `api.php` relays your uploaded photo to a free anonymous public
> host (catbox.moe) first, cached by content hash in `data/refcache.json`, so
> the same photo reuses the same URL across retries. If the relay is
> unreachable you'll get a clear error suggesting AI Repaint instead.
generation.

---

## API surface

| Endpoint | Purpose |
|---|---|
| `api.php?action=status` | Service + key health, saved image count, `busy`/`load` — whether the shared free engine is currently under load (recent busy queue, no success since) |
| `api.php?action=styles` | Full style dropdown list (keys + display names) |
| `api.php?action=enhance` | Rewrite / expand a prompt (free AI) |
| `api.php` (`action=generate`) | Create an image (POST form; `resolution` = `square`/`portrait`/`landscape` or `custom` with `res_w`/`res_h` — custom dims are snapped to 64px steps in the 256–768 range, auto-retried at the nearest supported size if the engine rejects them; with a reference: `engine=free` = keyless Perchance img2img, `engine=ai` = HuggingFace img2img) |
| `api.php?action=history` | List saved generations |
| `api.php?action=delete` | Remove a saved image (POST `id`) |
| `api.php?action=download&id=…` | Force-download a saved image |
| `api.php?action=download_all` | ZIP selected images into one download (POST `ids`, comma-separated) |
| `api.php?action=clear_all` | Delete every saved image + history row (POST) |
| `api.php?action=videokey` | Save / check the Replicate API key (POST `key` or GET) |
| `api.php?action=video_start` | Start a Replicate video prediction (POST `prompt`, `style`) → prediction `id` |
| `api.php?action=video_status&id=…` | Poll a prediction; saves + returns the MP4 when done |
| `api.php?action=hfkey` | Save / clear the HuggingFace token for ✨ AI Repaint |
| `api.php?action=repaint_save` | Save a rendered repaint (POST `image` data URL, `style`, `blend`) |
| `api.php?action=voices` | List available narrator voices (Edge TTS) |
| `api.php?action=tts` | Synthesize a narration clip (POST `text`, `voice`, `rate`) |
| `api.php?action=story_upload` | Save a rendered story video (POST body = video blob) |
| `api.php?action=upload3d` | Save a browser-rendered 3D parallax WebM to history (POST body = video blob, GET `mode`/`aspect`/`title`) |
| `api.php?action=setkey` | Advanced: paste a manual Perchance session key |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl+Enter` (or `Cmd+Enter`) | Forge the current batch |
| `S` | Roll a random seed (opens the Advanced panel so you can see it) |
| `←` / `→` | Previous / next image in the lightbox |
| `Esc` | Close lightbox / dialogs |

Shortcuts are ignored while typing in a field or when a dialog is open.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"Could not obtain an access key"** | You may be on a VPN (the service blocks them). Disable it, or visit `https://perchance.org/ai-text-to-image-generator` once in your browser and retry. |
| **"The image queue is busy"** | The free service throttles bursts. The header pill shows amber while this is happening — wait a few seconds and forge again. |
| **Slow generation** | Normal — free tier images queue behind other users. 10–40s is typical. |
| **Generation instantly fails** | Check PHP has `curl` enabled (`php -m` → look for `curl`). |
| **"Video mode needs a Replicate API key"** | Video costs GPU compute — paste an `r8_…` key in Video mode (replicate.com → account → API tokens). |
| **Video tile stuck on "Rendering…"** | The poll caps at ~10 minutes. The render may still be running server-side — click Forge again to start a fresh one. |
| **"AI Repaint needs a HuggingFace token"** | Grab a free `hf_…` token at huggingface.co/settings/tokens and save it below the reference image. |

### Manual Perchance key (advanced)

If you ever want to pin a key you grabbed yourself (from your browser's
DevTools → Network tab while using perchance.org — a 64-character hex string
that appears as `userKey` in requests to `image-generation.perchance.org`):

```
POST api.php
  action=setkey
  key=YOUR_64_HEX_KEY
```

Send an empty `key` to clear it and return to automatic keys.

---

## Files

```
pixelforge/
├── index.php          # the studio UI (Images / Video / Story modes)
├── api.php            # PHP backend (keys, generate, history, TTS, video, story)
├── styles.json        # 73 Perchance style templates (prompt text per style)
├── assets/
│   ├── style.css      # studio styles
│   └── app.js         # frontend logic
├── data/              # created automatically
│   ├── config.json    # video model + repaint model (API keys NOT stored here)
│   ├── key.json       # cached Perchance session key
│   ├── history.json   # generation metadata
│   ├── voices.json    # cached TTS voice list
│   ├── images/        # your generated images
│   └── videos/        # rendered videos (Replicate + story mode)
└── README.md
```

> **`pixelforge.secrets.php` lives TWO FOLDERS ABOVE this project** — at the
> project root, outside `Tools/pixelforge/` — and holds your Replicate /
> Pollinations / HuggingFace keys — see below.

---

## Where your API keys are stored

Keys are **never stored inside the web-accessible project folder** anymore.
PixelForge resolves them in this order (first match wins):

1. **Environment variables** — best for production/CI:
   `PIXELFORGE_REPLICATE_KEY` and `PIXELFORGE_HF_KEY`.
2. **`pixelforge.secrets.php`** — a small PHP file created two folders above
   the project (`../../pixelforge.secrets.php`, at the project root). It is
   executed server-side and
   refuses to run when requested over HTTP (returns an empty 403), so it can
   never be downloaded even if the parent folder is under your web root.
   This is where keys saved from the **Video mode** / **✨ AI Repaint** UI
   panels land.
3. **Legacy `data/config.json`** — older installs that still have keys there
   are read for back-compat, but PixelForge never writes keys back into it.

Saving a key in the UI writes `pixelforge.secrets.php`; clearing it removes the
entry. If that file can't be written, the UI shows an error telling you to set
the environment variable instead — keys never fall back into the web root.

Two things to keep in mind:

- **Environment variables win.** If `PIXELFORGE_*` is set for a key, saving a
  different key from the UI still reports success, but the environment value
  stays in effect until you unset it.
- **Moving the project?** Move `pixelforge.secrets.php` along with it — it
  must stay two folders above `pixelforge/` (at the project root).
  Alternatively set the `PIXELFORGE_*` environment variables — if you
  relocate only the project folder, a fresh empty secrets file is created at
  the new spot and you re-enter your keys.

> **Note:** The free Perchance service is community-run and may evolve its API
> over time. If generation ever breaks, it's usually a changed endpoint —
> easy to patch inside `api.php`.

---

## Video mode

Two engines, selectable in Video mode:

- **Free · no key** — prefers Pollinations (free key, no card, from
  enter.pollinations.ai — paste it in Video mode), falls back to the keyless
  Okatsu txt2video API (`video_free`). Best-effort quality, subject to free
  service availability.
- **Replicate · r8 key** — GPU text-to-video, higher quality, costs ~$0.05–0.30
  per clip. Add a key in Video mode (saved to `pixelforge.secrets.php` at the
  project root, two folders above the studio — never into the web root):

```
POST api.php  action=videokey  key=r8_…
```

The default model is `minimax/video-01` — to switch models, edit
`data/config.json` (`video_model`). Renders are ~30s–3min, produce a 5s 16:9
clip, and cost roughly $0.05–0.30 per clip. Videos save to `data/videos/` as
playable MP4s and appear in your history.
