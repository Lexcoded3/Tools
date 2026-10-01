# 🌐 WHOIS — Domain · IP · ASN Intelligence Terminal

A standalone hacker-terminal tool for instant **domain / IP / ASN intelligence**.
Type a query, get a clean key:value record — powered by **RDAP** (the modern,
JSON replacement for whois) with automatic fallbacks to the owning registries
(ARIN, RIPE) and classic **whois port 43** for domains.

**Keyless & free** — no API keys, no accounts, no rate-limit walls. Pure PHP +
vanilla JS, matching the rest of this tool family's CRT aesthetic.

---

## Quick start

```bash
cd whois
php -S localhost:8097        # any PHP server works — or drop it in XAMPP/htdocs
```

Then open `http://localhost:8097/` and type a query:

```
root@whois:~$ google.com          ← bare domain works
root@whois:~$ lookup 8.8.8.8
root@whois:~$ whois AS15169
root@whois:~$ lookup 2606:4700:4700::1111
```

## What you can query

| Query | Kind | Resolved by |
|---|---|---|
| `example.com` | Domain | RDAP (rdap.org → Verisign etc.) |
| `8.8.8.8` | IPv4 | RDAP IP allocation record |
| `2001:4860:4860::8888` | IPv6 | RDAP IP allocation record |
| `AS15169` / `15169` | ASN | RDAP (rdap.org → ARIN/RIPE fallbacks) |

Domains that fail RDAP are retried over classic **whois port 43**
(`whois.verisign-grs.com`, `whois.iana.org`) for their raw registrar record.

## Commands

| Command | What it does |
|---|---|
| `lookup <q>` / `whois <q>` | resolve a domain / IP / ASN |
| *(type it bare)* | `google.com` → same as `lookup google.com` |
| `help` | list commands |
| `clear` | clear the screen |
| `theme <name>` | phosphor: `green` · `amber` · `cyan` · `magenta` |
| `banner` | reprint the ASCII banner |
| `whoami` · `date` · `uptime` · `sudo` · `id` | easter eggs |

`↑`/`↓` recall past queries, click anywhere to focus the prompt, live clock in
the status bar, and every lookup is echoed with its data source.

## Files

```
whois/
├── index.html       # the terminal UI
├── api.php          # lookup proxy: RDAP + port-43 fallback (pure PHP)
├── assets/
│   ├── style.css    # CRT effects, scanlines, phosphor themes
│   └── app.js       # command shell + rendering
└── README.md
```

## How the backend works

1. **Classify** the query — domain regex, `FILTER_VALIDATE_IP`, or `AS\d+`.
2. **RDAP over HTTPS** — rdap.org bootstraps to the right registry. If it
   refuses to route an ASN/IP (it sometimes 404s), it retries ARIN's and
   RIPE's RDAP servers directly — no key needed.
3. **Port-43 fallback** — only for domains, only when RDAP comes back empty.
4. Every value is rendered via `textContent` (no HTML injection), output is
   capped at 255 chars/query, and the endpoint JSON-encodes everything.

Requires outbound HTTPS from PHP (`php-curl`, or streams fallback) and — for
the port-43 path only — `fsockopen`. Stock XAMPP ships both.
