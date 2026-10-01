/* ============================================================
   CIPHERLAB — Text & Cipher Workbench
   100% client-side. Nothing is uploaded anywhere.
   ============================================================ */
(() => {
"use strict";

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const inText = $("inText");
const outPane = $("outPane");
const cmdInput = $("cmd");

function pad(n) { return String(n).padStart(2, "0"); }

function bytesToHex(bytes) {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
}

function hexToBytes(hex) {
    hex = hex.replace(/\s+/g, "");
    if (hex.length % 2 !== 0) throw new Error("hex string has an odd number of digits");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) throw new Error("invalid hex digit at position " + (i * 2));
        out[i] = byte;
    }
    return out;
}

function utf8Bytes(str) { return new TextEncoder().encode(str); }

function bytesToB64(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function b64ToBytes(b64) {
    b64 = b64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) {
        throw new Error("invalid base64 payload");
    }
    let bin = "";
    try { bin = atob(b64); } catch { throw new Error("invalid base64 payload"); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/* ------------------------------------------------------------------ */
/* Output rendering                                                    */
/* ------------------------------------------------------------------ */

function setOut(htmlSafe, meta) {
    // htmlSafe may be text (rendered as-is) or { html, cls? } for rich output.
    if (typeof htmlSafe === "object" && htmlSafe.html) {
        outPane.innerHTML = htmlSafe.html;
    } else {
        outPane.textContent = String(htmlSafe);
    }
    $("outMeta").textContent = meta || "";
    $("stMode").textContent = meta ? "OK · " + meta : "OK";
}

function setErr(msg) {
    outPane.innerHTML = "";
    const el = document.createElement("div");
    el.className = "bad";
    el.textContent = "[!] " + msg;
    outPane.appendChild(el);
    $("outMeta").textContent = "error";
    $("stMode").textContent = "ERROR";
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

const enc = {
    "b64 enc": (s) => bytesToB64(utf8Bytes(s)),
    "b64 dec": (s) => {
        const dec = new TextDecoder("utf-8", { fatal: true });
        try { return dec.decode(b64ToBytes(s)); }
        catch { throw new Error("decoded bytes are not valid UTF-8 text"); }
    },
    "hex enc": (s) => bytesToHex(utf8Bytes(s)),
    "hex dec": (s) => {
        const dec = new TextDecoder("utf-8", { fatal: true });
        try { return dec.decode(hexToBytes(s)); }
        catch { throw new Error("decoded bytes are not valid UTF-8 text"); }
    },
    "url enc": (s) => encodeURIComponent(s),
    "url dec": (s) => decodeURIComponent(s.replace(/\+/g, " ")),
    rot13: (s) => s.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }),
    caesar: (s, shift) => {
        const n = ((Number(shift) % 26) + 26) % 26;
        return s.replace(/[a-zA-Z]/g, (c) => {
            const base = c <= "Z" ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base);
        });
    },
    upper: (s) => s.toUpperCase(),
    lower: (s) => s.toLowerCase(),
    title: (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
    camel: (s) => {
        const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
    },
    snake: (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join("_"),
    kebab: (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join("-"),
    constant: (s) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).join("_"),
    reverse: (s) => [...s].reverse().join(""),
    "sort lines": (s) => s.split("\n").sort((a, b) => a.localeCompare(b)).join("\n"),
    "uniq lines": (s) => [...new Set(s.split("\n"))].join("\n"),
    strip: (s) => s.replace(/\s+/g, " ").trim(),
    trim: (s) => s.trim(),
    "bin enc": (s) => [...utf8Bytes(s)].map((b) => b.toString(2).padStart(8, "0")).join(" "),
    "bin dec": (s) => {
        const bytes = s.trim().split(/\s+/).map((t) => {
            if (!/^[01]{1,8}$/.test(t)) throw new Error("binary chunk '" + t + "' is not 1-8 bits");
            return parseInt(t, 2);
        });
        return new TextDecoder().decode(new Uint8Array(bytes));
    },
};

/* ------------------------------------------------------------------ */
/* Hashes (SubtleCrypto) + MD5                                         */
/* ------------------------------------------------------------------ */

async function shaHex(algo, s) {
    const buf = await crypto.subtle.digest(algo, utf8Bytes(s));
    return bytesToHex(new Uint8Array(buf));
}

// Compact public-domain-style MD5 for completeness (SubtleCrypto lacks it).
function md5Hex(s) {
    const bytes = utf8Bytes(s);
    const n = bytes.length;
    const bits = n * 8;
    // Message + 0x80 pad + 8 length bytes, rounded up to a 64-byte block.
    const padded = new Uint8Array(((n + 72) >> 6) << 6);
    padded.set(bytes);
    padded[n] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bits >>> 0, true);
    dv.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);

    const K = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
    const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
               5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
               4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
               6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new DataView(padded.buffer);
    for (let off = 0; off < padded.length; off += 64) {
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = (F + A + K[i] + M.getUint32(off + g * 4, true)) >>> 0;
            A = D; D = C; C = B;
            B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
        }
        a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const hex = [];
    // MD5 digest words are little-endian.
    for (const v of [a0, b0, c0, d0]) {
        hex.push((v & 255).toString(16).padStart(2, "0"),
                 ((v >>> 8) & 255).toString(16).padStart(2, "0"),
                 ((v >>> 16) & 255).toString(16).padStart(2, "0"),
                 ((v >>> 24) & 255).toString(16).padStart(2, "0"));
    }
    return hex.join("");
}

/* ------------------------------------------------------------------ */
/* JSON / regex / diff / wc                                            */
/* ------------------------------------------------------------------ */

function jsonFmt(s, minify) {
    let parsed;
    try { parsed = JSON.parse(s); }
    catch (e) { throw new Error("invalid JSON: " + e.message); }
    return minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
}

function renderRegex(s, pattern, flags) {
    let re;
    try { re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g"); }
    catch (e) { throw new Error("bad regex: " + e.message); }
    if (!pattern) throw new Error("usage: regex <pattern> [/flags]");

    const frag = document.createDocumentFragment();
    let last = 0, count = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
        frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        const mark = document.createElement("span");
        mark.className = "hl";
        mark.textContent = m[0];
        frag.appendChild(mark);
        count++;
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on empty match
    }
    frag.appendChild(document.createTextNode(s.slice(last)));
    outPane.textContent = "";
    outPane.appendChild(frag);
    return count;
}

// Line diff via LCS — renders additions/removals in the output pane.
function diffLines(a, b) {
    const A = a.split("\n"), B = b.split("\n");
    const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
    for (let i = A.length - 1; i >= 0; i--) {
        for (let j = B.length - 1; j >= 0; j--) {
            dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const lines = [];
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
        if (A[i] === B[j]) { lines.push({ cls: "dim", t: "  " + A[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ cls: "bad", t: "- " + A[i] }); i++; }
        else { lines.push({ cls: "ok", t: "+ " + B[j] }); j++; }
    }
    while (i < A.length) lines.push({ cls: "bad", t: "- " + A[i++] });
    while (j < B.length) lines.push({ cls: "ok", t: "+ " + B[j++] });
    return lines;
}

function countWords(s) { return s.trim() === "" ? 0 : s.trim().split(/\s+/).length; }

function wcStats(s) {
    return {
        chars: [...s].length,
        bytes: utf8Bytes(s).length,
        words: countWords(s),
        lines: s === "" ? 0 : s.split("\n").length,
        longest: s.split("\n").reduce((m, l) => Math.max(m, [...l].length), 0),
    };
}

/* ------------------------------------------------------------------ */
/* Command shell                                                       */
/* ------------------------------------------------------------------ */

function helpText() {
    return [
        "  AVAILABLE COMMANDS",
        "  " + "─".repeat(52),
        "  ENCODE/DECODE",
        "  b64 enc|dec         base64 (utf-8 safe)",
        "  hex enc|dec         hex bytes ↔ text",
        "  url enc|dec         percent-encoding",
        "  bin enc|dec         binary bytes ↔ text",
        "  rot13               rot13 cipher",
        "  caesar <n>          caesar shift by n",
        "  HASH",
        "  md5 | sha1 | sha256 | sha384 | sha512",
        "  JSON",
        "  json fmt|min        pretty-print / minify (validates)",
        "  REGEX",
        "  regex <pat> [/flags]   live-match highlight, e.g. regex \\bfoo\\w* /gi",
        "  DIFF",
        "  diff <text>         line diff against current input",
        "  CASE / TEXT",
        "  upper lower title camel snake kebab constant",
        "  reverse sort lines uniq lines strip trim",
        "  wc                  chars · words · lines · bytes",
        "  OTHER",
        "  help · clear · theme <green|amber|cyan|magenta> · sample · loop",
        "  " + "─".repeat(52),
        "  transforms act on the INPUT pane; results land in OUTPUT",
    ].join("\n");
}

async function runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;

    const parts = cmd.split(/\s+/);
    const c = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");
    const input = inText.value;

    const useIn = () => { if (input === "") { setErr("INPUT pane is empty — paste something first"); return null; } return input; };

    try {
        switch (c) {
            case "help":
                showHelp();
                break;

            case "clear":
                outPane.innerHTML = "";
                $("outMeta").textContent = "—";
                $("stMode").textContent = "CLEARED";
                break;

            case "theme": {
                const name = arg.toLowerCase();
                if (!["green", "amber", "cyan", "magenta"].includes(name)) {
                    setErr("unknown theme — try green, amber, cyan, magenta");
                    break;
                }
                document.body.dataset.theme = name;
                break;
            }

            case "b64": {
                const s = useIn(); if (s === null) break;
                const mode = (parts[1] || "enc").toLowerCase();
                if (!["enc", "dec"].includes(mode)) { setErr("usage: b64 enc | b64 dec"); break; }
                const out = mode === "enc" ? enc["b64 enc"](s) : enc["b64 dec"](s);
                setOut(out, `${mode} · ${[...out].length} chars`);
                break;
            }

            case "hex": {
                const s = useIn(); if (s === null) break;
                const mode = (parts[1] || "enc").toLowerCase();
                if (!["enc", "dec"].includes(mode)) { setErr("usage: hex enc | hex dec"); break; }
                const out = mode === "enc" ? enc["hex enc"](s) : enc["hex dec"](s);
                setOut(out, `${mode} · ${[...out].length} chars`);
                break;
            }

            case "url": {
                const s = useIn(); if (s === null) break;
                const mode = (parts[1] || "enc").toLowerCase();
                if (!["enc", "dec"].includes(mode)) { setErr("usage: url enc | url dec"); break; }
                const out = mode === "enc" ? enc["url enc"](s) : enc["url dec"](s);
                setOut(out, `${mode} · ${[...out].length} chars`);
                break;
            }

            case "bin": {
                const s = useIn(); if (s === null) break;
                const mode = (parts[1] || "enc").toLowerCase();
                if (!["enc", "dec"].includes(mode)) { setErr("usage: bin enc | bin dec"); break; }
                const out = mode === "enc" ? enc["bin enc"](s) : enc["bin dec"](s);
                setOut(out, `${mode} · ${[...out].length} chars`);
                break;
            }

            case "rot13": {
                const s = useIn(); if (s === null) break;
                setOut(enc.rot13(s), "rot13 · done");
                break;
            }

            case "caesar": {
                const s = useIn(); if (s === null) break;
                const shift = parts[1];
                if (shift === undefined || !/^-?\d+$/.test(shift)) { setErr("usage: caesar <shift> — e.g. caesar 3"); break; }
                setOut(enc.caesar(s, shift), `caesar ${shift} · done`);
                break;
            }

            case "md5":
            case "sha1":
            case "sha256":
            case "sha384":
            case "sha512": {
                const s = useIn(); if (s === null) break;
                const algo = c === "md5" ? null : { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[c];
                const out = algo ? await shaHex(algo, s) : md5Hex(s);
                setOut(out, `${c.toUpperCase()} · ${out.length / 2} bytes`);
                break;
            }

            case "json": {
                const s = useIn(); if (s === null) break;
                const mode = (parts[1] || "fmt").toLowerCase();
                if (!["fmt", "min"].includes(mode)) { setErr("usage: json fmt | json min"); break; }
                const out = jsonFmt(s, mode === "min");
                setOut(out, `valid JSON · ${[...out].length} chars`);
                break;
            }

            case "regex": {
                const s = useIn(); if (s === null) break;
                if (!arg) { setErr("usage: regex <pattern> [/flags] — e.g. regex \\d{3,} /g"); break; }
                // split trailing /flags
                let pattern = arg, flags = "";
                const fm = arg.match(/^(.*?)\s*\/([dgimsuvy]+)$/);
                if (fm) { pattern = fm[1]; flags = fm[2]; }
                const count = renderRegex(s, pattern, flags);
                $("outMeta").textContent = count + " match" + (count === 1 ? "" : "es");
                $("stMode").textContent = "REGEX";
                if (count === 0) {
                    const n = document.createElement("div");
                    n.className = "faint";
                    n.textContent = "\n(no matches)";
                    outPane.appendChild(n);
                }
                break;
            }

            case "diff": {
                if (input === "") { setErr("INPUT pane is empty — put the ORIGINAL text there, then: diff <changed text>"); break; }
                if (!arg) { setErr("usage: diff <text to compare> — original lives in INPUT"); break; }
                const lines = diffLines(input, arg);
                const frag = document.createDocumentFragment();
                for (const l of lines) {
                    const el = document.createElement("div");
                    el.className = "line " + l.cls;
                    el.textContent = l.t;
                    frag.appendChild(el);
                }
                outPane.textContent = "";
                outPane.appendChild(frag);
                const adds = lines.filter((l) => l.t[0] === "+").length;
                const dels = lines.filter((l) => l.t[0] === "-").length;
                $("outMeta").textContent = "+" + adds + " −" + dels;
                $("stMode").textContent = "DIFF";
                break;
            }

            case "wc": {
                const s = useIn(); if (s === null) break;
                const st = wcStats(s);
                setOut([
                    `  characters ..... ${st.chars}`,
                    `  words .......... ${st.words}`,
                    `  lines .......... ${st.lines}`,
                    `  bytes .......... ${st.bytes}`,
                    `  longest line ... ${st.longest}`,
                ].join("\n"), "wc");
                break;
            }

            case "upper": case "lower": case "title":
            case "camel": case "snake": case "kebab": case "constant":
            case "reverse": case "strip": case "trim": {
                const s = useIn(); if (s === null) break;
                setOut(enc[c](s), c + " · done");
                break;
            }

            case "sort": {
                const s = useIn(); if (s === null) break;
                if ((parts[1] || "").toLowerCase() !== "lines") { setErr("usage: sort lines"); break; }
                setOut(enc["sort lines"](s), "sorted");
                break;
            }

            case "uniq": {
                const s = useIn(); if (s === null) break;
                if ((parts[1] || "").toLowerCase() !== "lines") { setErr("usage: uniq lines"); break; }
                setOut(enc["uniq lines"](s), "deduped");
                break;
            }

            default:
                setErr("unknown command '" + c + "' — type 'help'");
        }
    } catch (err) {
        setErr(err.message);
    }
}

function showHelp() {
    outPane.innerHTML = "";
    const pre = document.createElement("div");
    pre.className = "dim";
    pre.style.whiteSpace = "pre";
    pre.textContent = helpText();
    outPane.appendChild(pre);
    $("outMeta").textContent = "help";
    $("stMode").textContent = "HELP";
}

/* ------------------------------------------------------------------ */
/* Meta: input stats, loop, copy, sample                               */
/* ------------------------------------------------------------------ */

function refreshInMeta() {
    const st = wcStats(inText.value);
    $("inMeta").textContent = st.chars + " ch · " + st.words + " w · " + st.lines + " l";
}

const SAMPLE = JSON.stringify({
    name: "Zed-9",
    mission: "decode the uplink",
    targets: ["alpha", "bravo", "charlie"],
    access: { level: 4, region: "SECTOR-7" },
    note: "the quick brown fox jumps over 13 lazy dogs — 42",
}, null, 2);

function loadSample() {
    inText.value = SAMPLE;
    refreshInMeta();
    const frag = document.createDocumentFragment();
    const t = document.createTextNode(SAMPLE);
    frag.appendChild(t);
    outPane.textContent = "";
    outPane.appendChild(frag);
    $("outMeta").textContent = "sample loaded";
    $("stMode").textContent = "SAMPLE";
    // demo a hash immediately
    setTimeout(() => { runCommand("sha256"); cmdInput.focus(); }, 60);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const history = [];
let histIdx = -1;

cmdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        const v = cmdInput.value;
        cmdInput.value = "";
        runCommand(v);
        if (v.trim()) history.push(v);
        histIdx = -1;
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!history.length) return;
        histIdx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
        cmdInput.value = history[histIdx];
    } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx === -1) return;
        histIdx++;
        if (histIdx >= history.length) { histIdx = -1; cmdInput.value = ""; }
        else cmdInput.value = history[histIdx];
    }
});

inText.addEventListener("input", refreshInMeta);
outPane.addEventListener("click", () => cmdInput.focus());

$("btnSample").addEventListener("click", loadSample);
$("btnCopy").addEventListener("click", async () => {
    const text = outPane.innerText || outPane.textContent || "";
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        $("btnCopy").textContent = "✓ COPIED";
        setTimeout(() => { $("btnCopy").textContent = "⧉ COPY"; }, 1200);
    } catch {
        $("btnCopy").textContent = "✗ FAILED";
        setTimeout(() => { $("btnCopy").textContent = "⧉ COPY"; }, 1200);
    }
});

$("btnSwap").addEventListener("click", () => {
    const out = outPane.innerText || outPane.textContent || "";
    if (!out) return;
    inText.value = out;
    refreshInMeta();
    outPane.innerHTML = "";
    $("outMeta").textContent = "—";
    $("stMode").textContent = "LOOPED → INPUT";
});

/* ------------------------------------------------------------------ */
/* Clock + init                                                        */
/* ------------------------------------------------------------------ */

setInterval(() => {
    const d = new Date();
    $("stClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

window.addEventListener("DOMContentLoaded", () => {
    refreshInMeta();
    showHelp();
    cmdInput.focus();
});

})();
