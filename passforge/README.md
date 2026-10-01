# 🔑 PASSFORGE — Password & Passphrase Forge

A CRT-styled keysmith with three tabs:

- **⌨ PASSWORD** — forge random passwords with per-class control (upper /
  lower / digits / symbols) and an optional no-ambiguous-characters mode.
- **◈ PASSPHRASE** — diceware-style word phrases (3–10 words) with separators,
  capitalization and a numeric suffix.
- **☠ PWNED?** — check any password against **Have I Been Pwned**'s breach
  database without ever sending the password.

**Privacy-first design:** all generation uses `crypto.getRandomValues` locally.
The breach check uses HIBP's **k-anonymity** API — only the first 5 characters
of the SHA-1 hash ever leave your browser, which is useless to an attacker but
enough to look up the full range. No API key, no account, no cost.

---

## Quick start

Serve the folder (any PHP/static server) and open `passforge/index.html`, or
double-click it. Password and passphrase forge on load — tweak and re-forge.

### Password tab

- **LENGTH** slider (8–64, live re-forge).
- Class checkboxes: `A–Z`, `a–z`, `0–9`, `!@#$%`, and **no ambiguous**
  (drops `I O l 0 1` — the classic font-confusable set).
- Every generated password is guaranteed to contain **at least one character
  from each enabled class**, then securely shuffled (Fisher–Yates over
  `getRandomValues`).
- The entropy readout shows bits and a plain-language strength verdict:
  weak → paranoid.

### Passphrase tab

- **WORDS** slider (3–10) pulls from a self-contained 717-word list
  (≈9.5 bits/word).
- Separator: hyphen, space, dot, underscore, colon.
- Options to capitalize words and/or append a 2-digit number.
- `6 words + number` ≈ **61 bits** — comfortably strong and memorable.

### Pwned? tab

1. Type a password (never sent in full).
2. The tool SHA-1-hashes it locally, sends only the 5-char prefix to
   `api.pwnedpasswords.com/range/<prefix>`.
3. It searches the returned suffix list — a match reports **how many times**
   that password appears in known breaches.

## Files

```
passforge/
├── index.html       # three tabs: password / passphrase / pwned
├── assets/
│   ├── style.css    # CRT effects + forge controls
│   └── app.js       # generator, entropy math, HIBP k-anonymity client
└── README.md
```

## Notes

- Generation is offline-capable; only the **PWNED?** tab needs internet
  (and only 5 hash chars go out).
- The word list is curated to be unambiguous, memorable, and duplicate-free.
- Breach-check responses are parsed line-by-line; the whole suffix list is
  matched exactly (case-insensitive by construction — HIBP returns uppercase).