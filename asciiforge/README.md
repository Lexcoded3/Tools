# 🖼 ASCII FORGE — Image → ASCII Converter

Drop any image and forge it into **ASCII art** inside a CRT terminal: six
density ramps, live re-forging on control changes, color mode, inversion,
scale, and one-click copy of the finished art.

**100% local.** The image is decoded with your browser's canvas and never
leaves the machine. No server, no uploads, no API keys.

---

## Quick start

Open `asciiforge/index.html`, then either:

- **Drag & drop** an image anywhere on the screen, or
- Click the drop panel to **browse**, or
- Hit **◈ SAMPLE** to forge a built-in phosphor demo scene.

The art renders immediately. Tweak the controls and it re-forges live.

## Controls

| Control | What it does |
|---|---|
| **RAMP** | `classic` `.`-to-`@` shading · `blocks` `░▒▓█` · `shade` `▁▂▃▄▅▆▇█` · `braille` (2×4 px per glyph, ~2× resolution) · `binary` `01` · `hex` `0-f` |
| **SIZE** | 0.5× – 3× glyph count (column budget) |
| **INVERT** | flip light/dark (and invert colors in color mode) |
| **COLOR** | render each glyph in its source pixel's color (HTML spans) |
| **⧉ COPY ART** | copy the plain-text art to clipboard |
| **⟲ NEW IMAGE** | reset back to the drop panel |

Ramps are ordered so bright pixels become dense ink — art reads correctly on a
dark screen without flipping your mental model.

## Details

- Aspect ratio is preserved using real mono font metrics (0.62em advance ×
  0.82em line height at 8px), so circles stay circles.
- Column count adapts to the visible panel width and is capped (220 glyphs)
  so huge images stay snappy; braille doubles effective resolution per glyph.
- Copying in color mode copies the **plain ASCII** (colors are a view affordance).
- Clipboard works on `https`/`localhost` via the async API, with an
  `execCommand` fallback for plain HTTP.
- No assets shipped — the sample scene is drawn programmatically on a canvas.

## Files

```
asciiforge/
├── index.html       # drop panel + art output + controls
├── assets/
│   ├── style.css    # CRT effects + forge layout
│   └── app.js       # image pipeline + ramps + controls
└── README.md
```