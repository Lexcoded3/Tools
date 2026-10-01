# 🔲 QRTERM — Encode & Decode QR Codes

A CRT-styled QR workbench with two sides:

- **⌨ ENCODE** — turn text, URLs, WiFi credentials, emails, phone numbers and
  SMS into QR codes, then save them as PNG.
- **📷 DECODE** — point your camera at any QR code (live scanning) or decode
  from an image file.

Both engines are **client-side** and **keyless**. The heavy lifting libraries
(`qrcode` for generation, `jsQR` for decoding) lazy-load from jsDelivr on first
use — the same pattern PixelForge uses for Three.js — so the page itself stays
small and works offline until you actually generate or scan.

---

## Quick start

Serve the folder (any PHP/static server) and open `qrterm/index.html`, or
double-click the file. First use pulls the two libs from the CDN.

### Encode

1. Pick a **MODE**: `TEXT` · `URL` · `WIFI` · `EMAIL` · `TEL` · `SMS`.
2. Fill in the data:
   - **URL** — `example.com` is auto-prefixed to `https://`.
   - **WIFI** — SSID + password + security (WPA/WEP/none); special characters
     (`\ ; , : "`) are escaped per the WiFi-QR spec.
   - **EMAIL** — `address [subject]`.
   - **SMS** — `number [message]`.
3. Choose size (256–1024 px) and whether to keep the quiet zone.
4. **▚ GENERATE** (or press Enter in the data field) → **⤓ SAVE PNG**.

### Decode

- **🎥 CAMERA** — grants camera access and continuously scans (≈8 fps). When a
  QR is locked the result is shown and scanning pauses ~2.5 s so you can read
  it, then resumes. Click again to stop.
- **⏏ FROM IMAGE** — decode any PNG/JPG screenshot.

Decoded payloads render in the terminal window with a character count.

## Files

```
qrterm/
├── index.html       # encode + decode panels
├── assets/
│   ├── style.css    # CRT effects + QR panels
│   └── app.js       # payload builders, canvas gen, jsQR scan loop
└── README.md
```

## Privacy

Image decoding and generation happen entirely in the browser — files and camera
frames never leave your machine. The only network calls are the two CDN script
fetches on first use.

## Notes

- Payload validation gives friendly errors (bad phone numbers, empty data,
  unparseable emails) instead of silently producing junk codes.
- Camera requires `getUserMedia` over HTTPS or `localhost`.
- Error correction level is M (default) — a good balance for print and screen.