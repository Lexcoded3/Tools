# 🔍 IMGINTEL — Picture Intelligence Terminal

Drop any picture and extract its secrets — right in the browser, in the family's CRT terminal style.

## What it pulls out of an image

| Section | What you get | How |
|---|---|---|
| **FILE** | True file format via magic-byte sniffing (JPEG / PNG / GIF / WebP / BMP / TIFF / ICO / AVIF / HEIC), **extension-mismatch verdict** (`receipt.png` that's really a JPEG gets flagged), dimensions, bit depth / color type / variant, file size, SHA-256 hash | 100% local, zero libraries |
| **METADATA** | Camera make/model, software, capture datetime, exposure, aperture (f-stop), ISO, focal length, 35mm equivalent, flash, lens model, orientation, artist, copyright | A from-scratch **EXIF parser** (JPEG APP1 → TIFF IFD0 / ExifIFD / GPSIFD) — no libraries, works offline |
| **GPS** | Latitude/longitude in DMS + decimal, altitude, capture time in UTC, and a one-click OpenStreetMap link | same parser |
| **CODES** | Embedded QR codes and barcodes (EAN, UPC, Code 128/39/93, Data Matrix, Aztec, PDF417…) with their decoded payloads | native `BarcodeDetector` when available; jsQR (CDN) fallback |
| **OCR** | The text printed in the photo — receipts, prescriptions, signs, screenshots | Tesseract.js (CDN, lazy-loaded on first use) |
| **PALETTE** | The dominant colors as swatches with hex values + percentage coverage | canvas quantization, local |

## How to use it

- **Drop** an image on the left panel, or **click** to browse, or just **paste** from the clipboard (Ctrl/Cmd+V).
- Everything except OCR and the QR fallback runs instantly and **fully offline**.
- Hit **⬡ RUN OCR** to extract text (first use pulls the ~2 MB Tesseract engine from a CDN).
- **◈ SAMPLE** loads a generated "clinic prescription slip" to demo the pipeline — no assets shipped.
- **⧉ REPORT** copies the entire analysis as plain text (great for logs or sharing).

## Privacy

The image never leaves your machine: sniffing, dimensions, EXIF/GPS, palette, and hashing are pure local byte/canvas work. The two optional features that use the network are **OCR** (Tesseract.js engine from jsDelivr, then the image is processed locally in your browser) and the **jsQR fallback** (only if your browser lacks the native `BarcodeDetector`). SHA-256 hashing requires a secure context (`https://` or `localhost`) — otherwise it shows a note instead.

## Files

```
imgintel/
├── index.html      terminal shell — drop zone left, results right
├── assets/
│   ├── style.css   CRT family theme + imgintel layout
│   └── app.js      sniffers, native format parsers, EXIF/GPS parser,
│                   palette, code detection, OCR, rendering
└── README.md
```

## Notes

- EXIF parsing is written from scratch and unit-tested against hand-built TIFF/JPEG binaries (all IFD0 / ExifIFD / GPSIFD paths, rationals, inline vs. offset values, byte order).
- OCR pins its worker/core/language-data URLs to live jsDelivr endpoints on purpose — tesseract.js's built-in language host is dead, and pinned URLs were verified end-to-end in headless Chrome (sample image → extracted text, ~90% confidence). The script loader also has a 20 s timeout so a blocked CDN shows a clear error instead of hanging.
- If an image has no EXIF (e.g. most PNGs, screenshots, canvas exports), the METADATA section honestly says so.
- Browser-rendered dimensions may differ from the on-disk header for HEIC/AVIF — the tool reports the header values and falls back to the decoded image when a format has no native parser.