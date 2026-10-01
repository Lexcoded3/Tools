# 🔬 CIPHERLAB — Text & Cipher Workbench

A browser-only workbench for encoding, decoding, hashing, formatting and
analyzing text — wrapped in the family CRT terminal look. Paste text into the
**INPUT** pane, type a command at the `lab>` prompt, and the result lands in
the **OUTPUT** pane.

**100% local.** Every transform runs in your browser — no server, no uploads,
no API keys. Open `cipherlab/index.html` straight from disk and it just works.

---

## Quick start

Open `cipherlab/index.html` (double-click, or serve the folder with any PHP/
static server). Hit **◈ SAMPLE** to load a demo JSON payload, or paste your own
text into INPUT and type away:

```
lab> b64 enc
lab> b64 dec
lab> hex enc
lab> sha256
lab> json fmt
lab> wc
```

## Commands

**Encode / decode** — act on INPUT, write to OUTPUT:

| Command | Example |
|---|---|
| `b64 enc` / `b64 dec` | `b64 dec` on `aGVsbG8=` → `hello` |
| `hex enc` / `hex dec` | `hex enc` on `ABC` → `414243` |
| `url enc` / `url dec` | percent-encoding (plus-safe decode) |
| `bin enc` / `bin dec` | UTF-8 → 8-bit binary words and back |
| `rot13` | ROT13 cipher |
| `caesar <n>` | shift letters by `n` (negative works) |

**Hashes:**

| Command | Notes |
|---|---|
| `md5` | compact built-in (no network) |
| `sha1` `sha256` `sha384` `sha512` | via the browser's `crypto.subtle` |

**JSON:** `json fmt` (pretty-print + validate) · `json min` (minify + validate)

**Regex:** `regex <pattern> [/flags]` — e.g. `regex \b\d{3,}\b /g`. Matches are
highlighted live in OUTPUT with a match counter. Patterns and flags are
validated before running.

**Diff:** `diff <text>` — put the *original* in INPUT, run `diff` against a
changed copy. A line-based diff renders `+added` / `−removed` with counts.

**Case & text:** `upper` `lower` `title` `camel` `snake` `kebab` `constant`
`reverse` `sort lines` `uniq lines` `strip` `trim`

**Other:** `wc` (chars · words · lines · bytes · longest line) · `help` · `clear`
· `theme <green|amber|cyan|magenta>` · `sample` · `loop` (OUTPUT → INPUT for
chained transforms)

**UI extras:** ⇅ **LOOP** moves OUTPUT into INPUT so you can chain transforms
(e.g. `hex enc` → `url enc` on the result); ⧉ **COPY** grabs the output; `↑`/`↓`
recall commands; the input pane's live counter tracks chars/words/lines.

## Files

```
cipherlab/
├── index.html       # two-pane workbench UI
├── assets/
│   ├── style.css    # CRT effects + workbench panes
│   └── app.js       # all transforms + command shell (no dependencies)
└── README.md
```

## Notes

- Base64/hex/binary all round-trip through real UTF-8 bytes, so accented and
  CJK characters survive encode → decode cycles.
- MD5 is included for legacy checksum needs; prefer `sha256`+ for anything
  security-related.
- Regex empty-matches and zero-length patterns are handled without hanging the
  highlighter.
