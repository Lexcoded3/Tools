# 🧰 Tools — Codebuff Project Collection

A collection of 14 self-contained web tools and utilities. Most are
zero-backend static sites (open `index.html`); a few need PHP (XAMPP) or Node.

## Index

| Tool | What it does | Stack |
|---|---|---|
| [asciiforge](asciiforge/) | 🖼 Convert images to ASCII art | Static HTML/JS |
| [cipherlab](cipherlab/) | 🔬 Text & cipher workbench (encode/decode/classical ciphers) | Static HTML/JS |
| [imgintel](imgintel/) | 🔍 Picture intelligence terminal (EXIF, analysis) | Static HTML/JS |
| [medterm](medterm/) | ⚕ Symptom & drug reference terminal | Static HTML/JS |
| [myip](myip/) | 🌍 Instant public-IP lookup | Static HTML/JS |
| [passforge](passforge/) | 🔑 Password & passphrase forge with breach check (HIBP k-anonymity) | Static HTML/JS |
| [pixelforge](pixelforge/) | ⚡ AI media studio (images, TTS, video) — needs a PHP server + API key | PHP + JS |
| [qrterm](qrterm/) | 🔲 Encode & decode QR codes | Static HTML/JS |
| [siteripper](siteripper/) | 🕸 Download a website for offline browsing | PHP |
| [tubemp3](tubemp3/) | 🎧 YouTube audio extraction terminal (yt-dlp based) | Node + PHP |
| [website-mockup](website-mockup/) | 🎨 Generate website mockups | PHP + demo Vite app in `demo/` |
| [whatslog](whatslog/) | 👾 Decode exported WhatsApp chat `.txt` files locally — file never leaves the browser | Static HTML/JS |
| [whois](whois/) | 🌐 Domain · IP · ASN intelligence terminal | Static HTML/JS + PHP API |
| [winusb](winusb/) | 🛠 Build a bootable Windows USB that auto-installs your selected software after setup | C#/.NET (see `build.bat`) |

## Notes

- Runtime artifacts are intentionally not in this repo: `node_modules/`,
  `data/` outputs, job/task results, browser profiles, cookies, logs, and
  `.env` files. Each tool's README explains how to run it fresh.
- Static tools run by simply opening their `index.html`.
- PHP tools expect XAMPP (or any PHP host) with the folder under the webroot.
- `winusb` compiles with `build.bat` using the C# compiler built into Windows —
  no SDK required.
