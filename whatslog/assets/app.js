/* ============================================================
   WHATSL0G — Secure WhatsApp Transmission Decoder
   Pure client-side. The chat file never leaves your browser.
   ============================================================ */
(() => {
"use strict";

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const output = $("output");
const cmdInput = $("cmd");
const dropzone = $("dropzone");
const fileInput = $("fileInput");

function pad(n) { return String(n).padStart(2, "0"); }

function lineEl(cls, parts) {
    // parts: array of [text, className?]
    const el = document.createElement("div");
    el.className = "line" + (cls ? " " + cls : "");
    for (const [text, c] of parts) {
        const span = document.createElement("span");
        if (c) span.className = c;
        span.textContent = text;
        el.appendChild(span);
    }
    return el;
}

function echo(text, cls) {
    const el = document.createElement("div");
    el.className = "line" + (cls ? " " + cls : "");
    el.textContent = text;
    output.appendChild(el);
    return el;
}

function scrollBottom() {
    output.scrollTop = output.scrollHeight;
}

function scrollTop() {
    output.scrollTop = 0;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let messages = [];      // parsed chat
let fileName = "NO_SIGNAL";
let filterTerm = "";    // grep filter
let filterUser = "";    // user filter
let userColors = {};    // name -> color
let bootStart = Date.now();

const USER_PALETTE = [
    "#7CFC00", "#00FFFF", "#FFD700", "#FF69B4", "#7B68EE",
    "#FF7F50", "#87CEEB", "#98FB98", "#FFA500", "#E6E6FA",
    "#FF5555", "#55FF55",
];

function colorFor(name) {
    if (userColors[name]) return userColors[name];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    userColors[name] = USER_PALETTE[h % USER_PALETTE.length];
    return userColors[name];
}

/* ------------------------------------------------------------------ */
/* Banner art                                                          */
/* ------------------------------------------------------------------ */

const BANNER = [
    "\u2588     \u2588\u2588   \u2588 \u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588     \u2588\u2588\u2588  \u2588\u2588\u2588 ",
    "\u2588 \u2588   \u2588\u2588   \u2588\u2588   \u2588  \u2588  \u2588    \u2588    \u2588   \u2588\u2588    ",
    "\u2588  \u2588  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2588  \u2588\u2588\u2588\u2588\u2588\u2588    \u2588   \u2588\u2588 \u2588\u2588\u2588",
    "\u2588   \u2588 \u2588\u2588   \u2588\u2588   \u2588  \u2588      \u2588\u2588    \u2588   \u2588\u2588   \u2588",
    "\u2588    \u2588\u2588\u2588   \u2588\u2588   \u2588  \u2588  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2588\u2588\u2588   \u2588\u2588\u2588 ",
].join("\n");

const SAMPLE_CHAT = [
    "[12/24/2023, 10:12:03 PM] Zero_Cool: yo you up?",
    "[12/24/2023, 10:13:22 PM] AcidBurn: depends. is it about the mainframe?",
    "[12/24/2023, 10:13:40 PM] Zero_Cool: always. check this log i pulled",
    "[12/24/2023, 10:13:58 PM] Zero_Cool: first line of a multiline message",
    "second line right here",
    "third line, multiline hack confirmed",
    "[12/24/2023, 10:14:02 PM] AcidBurn: <Media omitted>",
    "[12/24/2023, 10:14:47 PM] AcidBurn: nice, it renders. want the decryption keys?",
    "[12/24/2023, 10:15:18 PM] Zero_Cool: always",
    "[12/24/2023, 10:15:20 PM] Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
    "[12/24/2023, 10:16:02 PM] AcidBurn: keys are in the README. happy hacking",
    "[12/24/2023, 10:16:30 PM] Zero_Cool: root@w4log:~$ sudo make me a sandwich",
    "[12/24/2023, 10:16:31 PM] AcidBurn: no.",
].join("\n");

/* ------------------------------------------------------------------ */
/* WhatsApp export parser                                              */
/* ------------------------------------------------------------------ */

// WhatsApp export headers come in two flavours:
//   bracket:  [M/D/YY, h:mm:ss AM] Name: message
//   dash:     M/D/YY, h:mm AM - Name: message
// Both are matched by one regex — the closing ] or ' - ' is optional.
const HEADER_RE = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\]?\s*(?:-\s+)?(.*)$/i;

function parseChat(text) {
    text = text.replace(/^\uFEFF/, ""); // strip BOM
    const lines = text.split(/\r?\n/);

    // Detect date order across all headers: a value > 12 must be the day.
    let order = "MD"; // default (US) when ambiguous
    for (const line of lines) {
        const m = HEADER_RE.exec(line);
        if (!m) continue;
        const a = +m[1], b = +m[2];
        if (a > 12) { order = "DM"; break; }
        if (b > 12) { order = "MD"; break; }
    }

    const msgs = [];
    for (const line of lines) {
        const m = HEADER_RE.exec(line);
        if (m) {
            let month = +m[1], day = +m[2];
            if (order === "DM") { month = +m[2]; day = +m[1]; }
            const y2 = +m[3];
            const year = y2 < 100 ? (y2 > 70 ? 1900 + y2 : 2000 + y2) : y2;
            let hour = +m[4];
            const minute = +m[5];
            const sec = m[6] ? +m[6] : 0;
            const ap = (m[7] || "").toUpperCase();
            if (ap) {
                if (ap[0] === "P" && hour < 12) hour += 12;
                else if (ap[0] === "A" && hour === 12) hour = 0;
            }
            const rest = m[8];

            let name = null, body = rest, system = false, media = false, edited = false;
            const ci = rest.indexOf(": ");
            if (ci > 0) {
                name = rest.slice(0, ci);
                body = rest.slice(ci + 2);
            } else {
                system = true;
            }

            if (body.includes("<This message was edited>")) {
                edited = true;
                body = body.replace("<This message was edited>", "").trim();
            }

            const trimmed = body.trim().toLowerCase();
            if (/^<.*>$/.test(body.trim())) {
                media = true;
                if (/deleted|encrypted|security code/.test(trimmed)) system = true;
            } else if (/media omitted|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|contact card omitted|location omitted|attachments?:/.test(trimmed)) {
                media = true;
            }

            msgs.push({
                ts: new Date(year, month - 1, day, hour, minute, sec),
                name, body, system, media, edited,
                cont: [], // continuation lines
            });
        } else if (msgs.length && line.trim() !== "") {
            msgs[msgs.length - 1].cont.push(line);
        }
    }
    return msgs;
}

function fmtTime(ts) {
    return `${pad(ts.getDate())}/${pad(ts.getMonth() + 1)}/${ts.getFullYear()} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
}

/* ------------------------------------------------------------------ */
/* Transcript rendering                                                */
/* ------------------------------------------------------------------ */

function view() {
    return messages.filter((msg) => {
        if (filterUser && (msg.name || "").toLowerCase() !== filterUser.toLowerCase()) return false;
        if (filterTerm && !((msg.name || "") + " " + msg.body).toLowerCase().includes(filterTerm.toLowerCase())) return false;
        return true;
    });
}

function renderTranscript() {
    const frag = document.createDocumentFragment();
    const list = view();

    if (list.length === 0) {
        echo("[!] no transmissions match the current filter", "warn");
        echo("    type 'all' to clear filters, 'help' for commands", "dim");
    }

    for (const msg of list) {
        const parts = [];
        parts.push([`[${fmtTime(msg.ts)}] `, "t"]);
        if (msg.system) {
            parts.push([":: ", "sys"]);
            parts.push([msg.body, "sys"]);
        } else {
            parts.push([msg.name + " ", "n"]);
            parts.push(["> ", "s"]);
            if (msg.media) {
                parts.push(["[ MEDIA OMITTED ]", "media"]);
            } else {
                parts.push([msg.body, "m"]);
                if (msg.edited) parts.push(["  <edited>", "sys"]);
            }
        }
        const el = lineEl("", parts);
        if (msg.name) el.style.color = colorFor(msg.name);
        // highlight grep matches
        if (filterTerm) {
            highlight(el, filterTerm);
        }
        frag.appendChild(el);

        // continuation lines
        if (msg.cont.length) {
            const contEl = document.createElement("div");
            contEl.className = "line";
            const indent = document.createElement("span");
            indent.textContent = "                     ";
            indent.className = "faint";
            contEl.appendChild(indent);
            const cont = document.createElement("span");
            cont.className = "cont";
            cont.textContent = msg.cont.join("\n" + " ".repeat(21));
            contEl.appendChild(cont);
            frag.appendChild(contEl);
        }
    }

    output.textContent = "";
    output.appendChild(frag);
    scrollBottom();
}

// Wrap grep matches in a highlight span, without breaking other spans.
function highlight(rootEl, term) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const lower = node.textContent.toLowerCase();
        const idx = lower.indexOf(term.toLowerCase());
        if (idx === -1) continue;
        const before = node.textContent.slice(0, idx);
        const match = node.textContent.slice(idx, idx + term.length);
        const after = node.textContent.slice(idx + term.length);
        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(before));
        const mark = document.createElement("span");
        mark.className = "hl";
        mark.textContent = match;
        frag.appendChild(mark);
        frag.appendChild(document.createTextNode(after));
        node.parentNode.replaceChild(frag, node);
    }
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function statsBlock() {
    const blocks = [];
    blocks.push(echo("", "dim"));
    blocks.push(echo("  [ TRANSMISSION ANALYSIS ]", "b"));
    blocks.push(echo("  " + "─".repeat(46), "faint"));

    const users = {};
    let words = 0, longest = "", longestName = null;
    let minTs = null, maxTs = null;
    for (const msg of messages) {
        if (msg.ts < minTs || !minTs) minTs = msg.ts;
        if (msg.ts > maxTs || !maxTs) maxTs = msg.ts;
        if (msg.name) users[msg.name] = (users[msg.name] || 0) + 1;
        if (!msg.system && !msg.media) {
            words += msg.body.split(/\s+/).filter(Boolean).length;
            if (msg.body.length > longest.length) { longest = msg.body; longestName = msg.name; }
        }
    }
    const total = messages.length;

    blocks.push(echo(`  messages ........... ${total}`, "dim"));
    blocks.push(echo(`  participants ....... ${Object.keys(users).length}`, "dim"));
    blocks.push(echo(`  timespan ........... ${minTs ? fmtTime(minTs) : "—"}  →  ${maxTs ? fmtTime(maxTs) : "—"}`, "dim"));
    blocks.push(echo(`  words .............. ${words.toLocaleString()}`, "dim"));
    if (longestName) blocks.push(echo(`  longest msg ........ ${longest.length} chars (${longestName})`, "dim"));

    // busiest hour
    const hours = new Array(24).fill(0);
    for (const msg of messages) hours[msg.ts.getHours()]++;
    let best = 0;
    for (let h = 1; h < 24; h++) if (hours[h] > hours[best]) best = h;
    blocks.push(echo(`  busiest hour ....... ${pad(best)}:00–${pad(best)}:59 (${hours[best]} msgs)`, "dim"));

    // top transmitters
    const sorted = Object.entries(users).sort((a, b) => b[1] - a[1]).slice(0, 10);
    blocks.push(echo("", "dim"));
    blocks.push(echo("  TOP TRANSMITTERS", "b"));
    const maxCount = sorted.length ? sorted[0][1] : 1;
    const barMax = 28;
    for (const [name, count] of sorted) {
        const bar = "█".repeat(Math.max(1, Math.round((count / maxCount) * barMax)));
        const pct = ((count / Math.max(1, total)) * 100).toFixed(1);
        const el = echo(`  ${name.padEnd(14)} ${bar.padEnd(barMax)} ${String(count).padStart(5)} (${pct}%)`, "dim");
        el.style.color = colorFor(name);
    }
    blocks.push(echo("  " + "─".repeat(46), "faint"));
    return blocks;
}

/* ------------------------------------------------------------------ */
/* Command shell                                                       */
/* ------------------------------------------------------------------ */

const HELP = [
    "  AVAILABLE COMMANDS",
    "  " + "─".repeat(46),
    "  help               show this help",
    "  stats              analyze the current chat",
    "  grep <term>        filter + highlight matching messages",
    "  search <term>      alias for grep",
    "  user <name>        show only one participant's messages",
    "  all                clear filters, show everything",
    "  clear              clear the screen",
    "  theme <name>       green | amber | cyan | magenta",
    "  demo               load the built-in sample chat",
    "  export             download parsed chat as JSON",
    "  banner             reprint the banner",
    "  whoami · date · uptime · sudo · id",
    "  " + "─".repeat(46),
    "  tip: drag & drop a .txt export anywhere to load it",
];

function runCommand(raw) {
    const cmd = raw.trim();
    echo(`root@w4log:~$ ${cmd}`, "dim");
    if (!cmd) return;

    const parts = cmd.split(/\s+/);
    const c = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    switch (c) {
        case "help":
            for (const l of HELP) echo(l, "dim");
            break;

        case "stats":
            if (!messages.length) { echo("[!] no chat loaded yet — load a file or type 'demo'", "warn"); break; }
            statsBlock();
            break;

        case "grep":
        case "search":
            if (!messages.length) { echo("[!] no chat loaded yet", "warn"); break; }
            if (!arg) { echo("[!] usage: grep <term>", "warn"); break; }
            filterTerm = arg;
            filterUser = "";
            renderTranscript();
            echo(`[+] ${view().length} matching transmission(s)`, "ok");
            scrollTop();
            break;

        case "user":
            if (!messages.length) { echo("[!] no chat loaded yet", "warn"); break; }
            if (!arg) { echo("[!] usage: user <name>", "warn"); break; }
            filterUser = arg;
            filterTerm = "";
            renderTranscript();
            echo(`[+] ${view().length} transmission(s) from '${arg}'`, "ok");
            scrollTop();
            break;

        case "all":
            filterTerm = "";
            filterUser = "";
            if (messages.length) renderTranscript();
            else echo("[+] filters cleared — no chat loaded", "ok");
            break;

        case "clear":
            output.textContent = "";
            printBanner(true);
            break;

        case "theme":
            if (!arg) { echo("[!] usage: theme <green|amber|cyan|magenta>", "warn"); break; }
            const name = arg.toLowerCase();
            if (!["green", "amber", "cyan", "magenta"].includes(name)) {
                echo("[!] unknown theme. try: green, amber, cyan, magenta", "warn");
                break;
            }
            document.body.dataset.theme = name;
            echo(`[+] phosphor set to ${name}`, "ok");
            break;

        case "demo":
        case "sample":
            loadChat(SAMPLE_CHAT, "sample_transmission.txt");
            break;

        case "export":
            if (!messages.length) { echo("[!] no chat loaded yet", "warn"); break; }
            const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "whatslog_export.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            echo("[+] exported parsed chat as whatslog_export.json", "ok");
            break;

        case "banner":
            printBanner(true);
            break;

        case "whoami":
            echo("root", "ok");
            break;
        case "id":
            echo("uid=0(root) gid=0(root) groups=0(root)", "ok");
            break;
        case "date":
            echo(new Date().toString(), "dim");
            break;
        case "uptime": {
            const up = Math.floor((Date.now() - bootStart) / 1000);
            echo(`up ${Math.floor(up / 60)} min, ${up % 60} sec, load average: 0.00, 0.00, 0.00`, "dim");
            break;
        }
        case "sudo":
            echo("[!] user root is not in the sudoers file. this incident will be reported.", "warn");
            break;
        case "rm":
            echo("[!] permission denied. nice try.", "warn");
            break;
        case "exit":
        case "logout":
            echo("[!] there is no escape from the terminal.", "warn");
            break;
        default:
            echo(`-bash: ${c}: command not found`, "err");
            echo("    type 'help' for available commands", "faint");
    }
    scrollBottom();
}

/* ------------------------------------------------------------------ */
/* Loading + decrypt animation                                         */
/* ------------------------------------------------------------------ */

function loadChat(text, name) {
    messages = parseChat(text);
    userColors = {};
    fileName = name || "transmission.txt";
    filterTerm = "";
    filterUser = "";

    $("stFile").textContent = fileName;
    $("stMsgs").textContent = `msgs: ${messages.length}`;
    const users = new Set(messages.filter((m) => m.name).map((m) => m.name));
    $("stUsers").textContent = `users: ${users.size}`;

    dropzone.classList.add("hidden");

    decryptAnimation(() => {
        renderTranscript();
        echo(`[+] decrypted ${messages.length} message(s) from '${fileName}'`, "ok");
        echo("    type 'stats' for analysis, 'help' for commands", "faint");
        scrollBottom();
    });
}

function decryptAnimation(done) {
    output.textContent = "";
    echo("  [ DECRYPTING E2E LAYER ]", "b");
    echo("  " + "─".repeat(46), "faint");

    const wrap = document.createElement("div");
    wrap.className = "progress-wrap";
    const label = document.createElement("div");
    label.className = "progress-label";
    label.textContent = "cracking session key...";
    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    track.appendChild(fill);
    wrap.appendChild(label);
    wrap.appendChild(track);
    const hex = document.createElement("div");
    hex.className = "hex-stream";
    wrap.appendChild(hex);
    output.appendChild(wrap);

    const HEX = "0123456789abcdef";
    let p = 0;
    const timer = setInterval(() => {
        p += 3 + Math.random() * 9;
        if (p >= 100) p = 100;
        fill.style.width = p + "%";
        label.textContent = p < 100 ? `cracking session key... ${Math.floor(p)}%` : "session key acquired. reassembling packets...";
        let row = "";
        for (let i = 0; i < 96; i++) row += HEX[Math.floor(Math.random() * 16)];
        hex.textContent = row;
        if (p >= 100) {
            clearInterval(timer);
            setTimeout(done, 300);
        }
    }, 60);
}

/* ------------------------------------------------------------------ */
/* Boot sequence                                                       */
/* ------------------------------------------------------------------ */

const BOOT_LINES = [
    ["[ OK ] initializing kernel modules", "ok"],
    ["[ OK ] mounting /dev/wa_chat", "ok"],
    ["[ OK ] loading e2e decryption layer", "ok"],
    ["[ OK ] acquiring session key", "ok"],
    ["[ OK ] scanning for local .txt payloads", "dim"],
    ["[ OK ] terminal ready", "ok"],
];

async function boot() {
    printBanner(false);
    for (const [text, cls] of BOOT_LINES) {
        echo(text, cls);
        scrollBottom();
        await new Promise((r) => setTimeout(r, 130 + Math.random() * 160));
    }
    echo("");
    echo("> awaiting transmission...", "b");
    echo("  drop a WhatsApp .txt export anywhere, or type 'demo'", "faint");
    scrollBottom();
}

function printBanner(withSub) {
    const el = document.createElement("div");
    el.className = "banner";
    el.textContent = BANNER;
    output.appendChild(el);
    if (withSub) {
        echo("  SECURE WHATSAPP TRANSMISSION DECODER v2.4", "dim");
        echo("", "dim");
    }
}

/* ------------------------------------------------------------------ */
/* File input + drag & drop                                            */
/* ------------------------------------------------------------------ */

function openFile() {
    fileInput.click();
}

fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadChat(String(reader.result), file.name);
    reader.readAsText(file);
    fileInput.value = "";
});

dropzone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    openFile();
});

["dragenter", "dragover"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragging"); })
);
["dragleave", "drop"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragging"); })
);
window.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => loadChat(String(reader.result), file.name);
        reader.readAsText(file);
    }
});

$("btnLoad").addEventListener("click", openFile);
$("btnSample").addEventListener("click", () => loadChat(SAMPLE_CHAT, "sample_transmission.txt"));
$("dzBrowse").addEventListener("click", (e) => { e.stopPropagation(); openFile(); });
$("dzSample").addEventListener("click", (e) => {
    e.stopPropagation();
    loadChat(SAMPLE_CHAT, "sample_transmission.txt");
});

/* ------------------------------------------------------------------ */
/* Command input                                                       */
/* ------------------------------------------------------------------ */

const history = [];
let histIdx = -1;

cmdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        const v = cmdInput.value;
        runCommand(v);
        if (v.trim()) history.push(v);
        histIdx = -1;
        cmdInput.value = "";
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

// clicking the terminal focuses the prompt
$("term").addEventListener("click", () => cmdInput.focus());
output.addEventListener("click", () => cmdInput.focus());

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

setInterval(() => {
    const d = new Date();
    $("stClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

window.addEventListener("DOMContentLoaded", () => {
    // render banner into dropzone as well
    const dzB = $("dzBanner");
    dzB.textContent = BANNER;
    boot();
    cmdInput.focus();
});

})();
