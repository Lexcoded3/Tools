# MOCKUPGEN — Website Mockup Generator

Paste a URL **or** upload your own screenshots, and preview the site inside real device
frames — MacBook Pro, iPad Mini, iPhone X, iPhone SE — with a hacker terminal UI that
matches the rest of the `tools/` family (whatslog, siteripper, pixelforge).

Built in pure PHP + vanilla JS. No Node, no React, no build step.

## Modes

### 01 · URL_MODE
Type any URL and hit **Preview**. `preview.php` fetches the site **server-side**
(a tiny proxy, like the Express server in the original demo — this is what makes
cross-origin fetching work), injects a `<base>` tag so relative images/CSS/JS resolve,
and streams the HTML into four device iframes. Scales to any screen — it's a real
live render, not a screenshot.

### 02 · UPLOAD_MODE
Upload a screenshot (`.png` / `.jpg` / `.webp`), pick a device, and PHP GD composites
it into a hand-drawn device frame (cover-cropped, centered) → download the PNG.

## Files

| File | Purpose |
|---|---|
| `index.php`   | The tool UI (URL + Upload tabs, device frames) |
| `preview.php` | Server-side URL proxy for the iframes |
| `mockup.php`  | GD compositor for upload mode |
| `assets/style.css` | CRT hacker theme + pure-CSS device frames |
| `assets/app.js`    | Tabs, preview loading, upload flow |
| `data/`       | Generated mockup PNGs (auto-cleaned after 2h) |

## Run

Drop this folder anywhere inside `htdocs` and open:

```
http://localhost/tools/website-mockup/
```

Requires PHP with **cURL** and **GD** extensions (both ship with XAMPP).

## Notes

- `preview.php` blocks `localhost` fetches (SSRF guard) — use a public URL in URL_MODE.
- Generated mockups are written to `data/` and cleaned up after 2 hours.
- Original demo (React + Express) is preserved in `demo/` for reference.
