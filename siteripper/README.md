# SiteRipper 🕸️

Export a live website — or a WordPress demo like `demo.pro.radio/wp38` — into an **editable static project** you can customise and host anywhere.

Built as a self-contained PHP tool that runs in XAMPP. No database, no composer, no external services.

## What it does

- Crawls a site (BFS, same host) up to a page + depth limit
- Saves HTML, CSS, JS, images, fonts, audio/video into a clean folder
- **Rewrites absolute URLs to relative paths** so the exported site works offline and in a subfolder
- Rewrites `url(...)` / `@import` inside CSS and downloads those assets too
- Handles WordPress-specific bits: cache-buster query strings, `data-src`/`data-original` lazy-loading, `srcset`, `og:image`, `<base>` tags
- **Local folder import** — point it at a downloaded template folder (e.g. `html_backup/`) and it copies it into a project
- Exports a **ZIP** of the whole project
- Live progress via web UI or a CLI
- **Cloudflare / bot-fight sites** — when PHP's cURL gets challenged (the "Just a moment…" page), SiteRipper automatically retries via the OS `curl` binary (Schannel on Windows), which passes these checks. Works out of the box on Windows 10+; the retry is skipped on systems without a `curl` binary
- **Politeness + retries** — a short delay between requests and retry-with-backoff on transient network failures, so rate-limited hosts (Cloudflare, CDNs) don't drop the crawl

## Web UI

Open in the browser:

```
http://localhost/2026/AttanNew/Tools/siteripper/
```

1. Paste a URL (e.g. `https://demo.pro.radio/wp38`) **or** a local folder path (e.g. `C:/xampp/htdocs/2026/AttanNew/Tools/html_backup`)
2. Tune options (media, external assets, robots.txt, page/depth limits)
3. Hit **Export site** — watch live progress
4. **Preview** the exported site in-browser, or **Download ZIP**

## CLI

```bash
cd /c/xampp/htdocs/2026/AttanNew/Tools/siteripper

php cli.php https://demo.pro.radio/wp38
php cli.php https://demo.pro.radio/wp38 --max-pages=150 --depth=4 --external
php cli.php "C:/xampp/htdocs/2026/AttanNew/Tools/html_backup" --out=my-radiosite
```

| Option | Default | Meaning |
|---|---|---|
| `--max-pages=N` | 100 | crawl page limit |
| `--depth=N` | 5 | max link depth |
| `--external` | off | also mirror external-host assets |
| `--no-media` | off | skip `<img>`/`<source>`/`<video>` media (CSS backgrounds & fonts are always kept so the layout still renders) |
| `--no-robots` | off | ignore robots.txt |
| `--speed=MODE` | `balanced` | `fast` · `balanced` · `polite` — controls the politeness delay and retry backoff (see below) |
| `--out=NAME` | auto | output job id / folder name |

## Speed presets

Controls the delay between requests and how hard the ripper retries on transient network failures. The web UI has a segmented **Speed** selector; the CLI uses `--speed=`.

| Mode | Delay / request | Retry attempts | Best for |
|---|---|---|---|
| `fast` | 0.05s | 1 (no retries) | quick rips on friendly sites |
| `balanced` (default) | 0.35s | 3 (2s/4s backoff) | most sites |
| `polite` | 1s | 5 (3s/6s/9s/12s backoff) | Cloudflare/CDN-protected or rate-limited hosts |

Cloudflare-fronted demos (like `demo.pro.radio`) are slow no matter what — expect roughly a minute per page with `balanced`. Use `fast` on plain sites, `polite` when a site starts dropping connections.

## Where does the output go?

```
siteripper/jobs/<job-id>/
├── site/          ← the exported project (mirrored site)
├── state.json     ← crawl progress state
├── report.txt     ← failures + summary
└── export.zip     ← created on demand (web: "Download ZIP")
```

The `site/` folder is the actual project — take it, edit the HTML/CSS, drop it into XAMPP `htdocs`, or upload it anywhere.

## How the rewriting works

- Same-host page links → rewritten to relative paths (e.g. `/wp38/about/` → `../about/index.html`), and that page is queued for crawling
- Same-host assets → downloaded into the mirrored path, referenced relatively
- External-host assets → left as absolute URLs unless `--external` (then stored under `external/<host>/…`)
- `mailto:`, `tel:`, `javascript:`, `#`, `data:`, `blob:` URLs are left untouched
- WordPress `?ver=…` cache busters are stripped from asset paths
- `<base>` tags are removed so relative resolution stays correct

## Notes & limitations

- **Use on sites you have permission to export.** Demo sites of premium themes are the theme author's property — for a commercial project, buy the theme instead (its demo importer gives you the real editable WordPress project).
- A static export has no PHP backend: forms, WordPress admin, and server-side features won't function — it's the *front end* you get, fully editable.
- JS-heavy sites may need `--external` for CDN scripts, or manual tweaks after export.
- `jobs/` is blocked from direct web access (`jobs/.htaccess`); previewing goes through `index.php?action=view`.
- Requires the PHP `curl`, `dom`, `mbstring`, and `zip` extensions (all enabled in stock XAMPP).
- For best results start from the site's homepage — crawling deep random URLs yields a partial tree.

## Structure

```
siteripper/
├── index.php      web UI + JSON endpoints
├── cli.php        CLI entry point
├── lib/Ripper.php core engine (crawl, rewrite, mirror, zip)
├── jobs/          job output (auto-created, web-protected)
└── README.md
```
