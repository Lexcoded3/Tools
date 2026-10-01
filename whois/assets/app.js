/* ============================================================
   WHOIS — Domain · IP · ASN Intelligence Terminal
   Keyless RDAP lookups through a small PHP proxy (api.php).
   ============================================================ */
(() => {
"use strict";

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const output = $("output");
const cmdInput = $("cmd");

function pad(n) { return String(n).padStart(2, "0"); }

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

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let busy = false;
let bootStart = Date.now();
let lastQuery = "--";

const BANNER = [
    "  _      __ ___  _    ___   ",
    " | | /| / // _ \\| |  / __ \\ ",
    " | |/ |/ / , _/| |_/ /_/ / ",
    " |__/|__/_/|_| |____\\____/  ",
].join("\n");

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

async function lookup(q) {
    if (busy) { echo("[!] lookup already in progress — wait for it to finish", "warn"); return; }
    q = (q || "").trim();
    if (!q) { echo("[!] usage: lookup <domain|ip|asn> — e.g. lookup google.com", "warn"); return; }
    if (q.length > 255) { echo("[!] query too long (max 255 chars)", "warn"); return; }

    busy = true;
    lastQuery = q;
    $("stLast").textContent = "last: " + q;
    const mark = echo(`> interrogating registries for '${q}' ...`, "dim");
    scrollBottom();

    try {
        const url = "api.php?action=lookup&q=" + encodeURIComponent(q);
        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        if (!data) throw new Error("registries returned garbage (HTTP " + res.status + ")");
        if (!data.ok) throw new Error(data.error || "lookup failed (HTTP " + res.status + ")");
        renderRecord(data);
        echo(`[+] ${data.source} · ${(data.lines || []).length} field(s)`, "ok");
        mark.classList.remove("dim");
        mark.classList.add("ok");
    } catch (err) {
        mark.classList.remove("dim");
        mark.classList.add("err");
        echo("[!] " + err.message, "err");
        echo("    check your connection — the proxy needs outbound HTTPS", "faint");
    } finally {
        busy = false;
        scrollBottom();
    }
}

function renderRecord(data) {
    const kindLabel = { domain: "DOMAIN", ip: "IP", asn: "ASN" }[data.kind] || "RECORD";
    echo("");
    echo("  ── " + kindLabel + " :: " + (data.query || "") + " " + "─".repeat(Math.max(0, 44 - 11 - String(data.query || "").length)), "b");
    for (const line of data.lines || []) {
        const k = String(line.k || "").padEnd(15);
        echo("  " + k + " " + line.v, "dim");
    }
    echo("  " + "─".repeat(46), "faint");
}

/* ------------------------------------------------------------------ */
/* Help & easter eggs                                                  */
/* ------------------------------------------------------------------ */

const HELP = [
    "  AVAILABLE COMMANDS",
    "  " + "─".repeat(46),
    "  lookup <q>        domain | IP | IPv6 | AS number (alias: whois)",
    "  help              show this help",
    "  clear             clear the screen",
    "  theme <name>      green | amber | cyan | magenta",
    "  banner            reprint the banner",
    "  whoami · date · uptime · sudo · id",
    "  " + "─".repeat(46),
    "  tip: just type a domain / IP / ASN and hit Enter",
];

function runCommand(raw) {
    const cmd = raw.trim();
    if (cmd) echo(`root@whois:~$ ${cmd}`, "dim");
    if (!cmd) return;

    const parts = cmd.split(/\s+/);
    const c = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    switch (c) {
        case "help":
            for (const l of HELP) echo(l, "dim");
            break;

        case "lookup":
        case "whois":
            lookup(arg);
            break;

        case "clear":
            output.textContent = "";
            printBanner(false);
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
            // A bare domain / IP / ASN is a lookup.
            if (/^(?:[a-z0-9.-]+\.[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]+|AS?\d{1,10})$/i.test(cmd)) {
                lookup(cmd);
            } else {
                echo(`-bash: ${c}: command not found`, "err");
                echo("    type 'help' for available commands", "faint");
            }
    }
    scrollBottom();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function printBanner(withSub) {
    const el = document.createElement("div");
    el.className = "banner";
    el.textContent = BANNER;
    output.appendChild(el);
    if (withSub) {
        echo("  REGISTRY INTELLIGENCE TERMINAL v1.0", "dim");
        echo("", "dim");
    }
}

const BOOT_LINES = [
    ["[ OK ] initializing rdap client", "ok"],
    ["[ OK ] connecting to rdap.org bootstrap", "ok"],
    ["[ OK ] loading registry fallbacks (arin · ripe)", "ok"],
    ["[ OK ] opening whois port 43 tunnel", "dim"],
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
    echo("> awaiting query...", "b");
    echo("  type a domain, IP, IPv6, or ASN — or 'help'", "faint");
    scrollBottom();
}

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

$("btnExample").addEventListener("click", () => {
    cmdInput.value = "lookup example.com";
    runCommand("lookup example.com");
});

window.addEventListener("DOMContentLoaded", () => {
    boot();
    cmdInput.focus();
});

})();
