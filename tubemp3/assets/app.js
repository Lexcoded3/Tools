/* ============================================================
   TUBEMP3 — YouTube audio liberation terminal
   Talks to api.php (yt-dlp/ffmpeg engine or legacy fallback).
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

let engine = null;      // status payload from api.php
let currentInfo = null; // last info payload
let selectedQuality = "128";
let jobs = [];          // completed jobs this session
let bootStart = Date.now();

/* ------------------------------------------------------------------ */
/* Banner art                                                          */
/* ------------------------------------------------------------------ */

const BANNER = [
    "████████ ███   ███ ██████  ████████ ██████  ██████ ",
    "   ██    ████ ████ ██   ██    ██    ██   ██ ██   ██",
    "   ██    ██ ███ ██ ██████     ██    ██████  ██████ ",
    "   ██    ██     ██ ██   ██    ██    ██   ██ ██   ██",
    "   ██    ██     ██ ██   ██    ██    ██   ██ ██████ ",
].join("\n");

/* ------------------------------------------------------------------ */
/* API helpers                                                         */
/* ------------------------------------------------------------------ */

async function api(url, opts) {
    const res = await fetch(url, opts);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("ndjson")) return res;
    const data = await res.json().catch(() => ({ ok: false, error: "bad response" }));
    return data;
}

async function refreshStatus() {
    const st = await api("api.php?action=status");
    if (st && st.ok) {
        engine = st;
        const eng = st.engine === "NODE" ? "NODE (ytdl-core+ffmpeg)"
            : st.engine === "FULL" ? "FULL (yt-dlp+ffmpeg)"
            : st.engine === "YTDLP-NO-FFMPEG" ? "YTDLP (no ffmpeg)"
            : "LEGACY (pure php)";
        $("stEngine").textContent = "ENGINE: " + eng;
        $("stFiles").textContent = "files: " + st.files;
        if (st.qualities && !st.qualities.includes("128")) {
            // only source available — pin selection
            selectedQuality = "source";
        }
        if (st.note) echo("[!] " + st.note, "warn");
    } else {
        $("stEngine").textContent = "ENGINE: OFFLINE";
        echo("[!] api.php unreachable — is PHP serving this folder?", "err");
    }
    return engine;
}

/* ------------------------------------------------------------------ */
/* URL validation (mirrors server-side)                                */
/* ------------------------------------------------------------------ */

function videoIdFromUrl(raw) {
    let url = (raw || "").trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let host;
    try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
    if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return null;
    const m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
        || url.match(/[?&]v=([A-Za-z0-9_-]{11})/)
        || url.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Acquire: fetch info + show target card                             */
/* ------------------------------------------------------------------ */

async function acquire(url) {
    const id = videoIdFromUrl(url);
    if (!id) {
        echo("[!] that is not a YouTube link", "err");
        echo("    try: fetch https://www.youtube.com/watch?v=...", "faint");
        return;
    }

    echo(`[*] resolving target ${id} ...`, "dim");
    const res = await api("api.php?action=info&url=" + encodeURIComponent(url));
    if (!res.ok) {
        echo("[!] " + (res.error || "resolve failed"), "err");
        return;
    }
    currentInfo = res;

    echo(`[+] TARGET ACQUIRED — "${res.title}"`, "ok");
    echo(`    channel: ${res.channel} · duration: ${res.durationTxt}` + (res.views ? ` · views: ${res.views.toLocaleString()}` : ""), "dim");

    // target card with ASCII thumbnail
    const card = document.createElement("div");
    card.className = "target-card";
    const row = document.createElement("div");
    row.className = "target-row";
    const meta = document.createElement("div");
    meta.className = "target-meta";

    const t = document.createElement("div");
    t.className = "target-title";
    t.textContent = res.title;
    meta.appendChild(t);

    const sub = document.createElement("div");
    sub.className = "target-sub";
    sub.textContent = `${res.channel}  ·  ${res.durationTxt}`;
    meta.appendChild(sub);

    // quality selector
    const qrow = document.createElement("div");
    qrow.className = "quality-row";
    const qlabel = document.createElement("div");
    qlabel.className = "quality-label";
    qlabel.textContent = "AUDIO QUALITY";
    qrow.appendChild(qlabel);
    const qseg = document.createElement("div");
    qseg.className = "quality-seg";
    const qualities = engine && engine.qualities && engine.qualities.length
        ? engine.qualities : ["128", "source"];
    for (const q of ["64", "128", "192", "320", "source"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "qseg";
        b.textContent = q === "source" ? "SOURCE (native)" : q + " kbps";
        if (qualities.includes(q)) {
            b.addEventListener("click", () => {
                selectedQuality = q;
                qseg.querySelectorAll(".qseg").forEach((x) => x.classList.remove("active"));
                b.classList.add("active");
            });
            if (q === selectedQuality) b.classList.add("active");
        } else {
            b.disabled = true;
            b.title = "requires the node engine or yt-dlp + ffmpeg";
        }
        qseg.appendChild(b);
    }
    qrow.appendChild(qseg);

    const grab = document.createElement("button");
    grab.type = "button";
    grab.className = "result-btn";
    grab.textContent = "▶ LIBERATE AUDIO";
    grab.style.marginTop = "10px";
    grab.addEventListener("click", () => liberate(res, selectedQuality));
    qrow.appendChild(grab);

    meta.appendChild(qrow);
    row.appendChild(meta);

    // ASCII thumbnail (client-side, CORS-friendly via ytimg thumbnails)
    const art = document.createElement("div");
    art.className = "target-art";
    art.textContent = "loading thumb...";
    row.appendChild(art);
    card.appendChild(row);
    output.appendChild(card);
    scrollBottom();
    asciiThumb(res.thumb, art);
}

/* ------------------------------------------------------------------ */
/* ASCII thumbnail                                                     */
/* ------------------------------------------------------------------ */

const ART_CHARS = " .:-=+*#%@";

function asciiThumb(url, el) {
    if (!url) { el.textContent = ""; return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        try {
            const w = 48, h = 27;
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            let out = "";
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
                    out += ART_CHARS[Math.min(ART_CHARS.length - 1, Math.floor(lum * ART_CHARS.length))];
                }
                out += "\n";
            }
            el.textContent = out;
        } catch {
            el.textContent = "";
        }
    };
    img.onerror = () => { el.textContent = ""; };
    img.src = url;
}

/* ------------------------------------------------------------------ */
/* Liberate: stream NDJSON progress                                    */
/* ------------------------------------------------------------------ */

async function liberate(info, quality) {
    if (!info) { echo("[!] acquire a target first", "warn"); return; }

    // result row for the job
    const row = document.createElement("div");
    row.className = "result-row";
    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = "[" + info.id + "] " + info.title;
    row.appendChild(name);
    const sizeEl = document.createElement("span");
    sizeEl.className = "result-size";
    sizeEl.textContent = "liberating...";
    row.appendChild(sizeEl);
    output.appendChild(row);
    scrollBottom();

    echo(`[>] LIBERATING — ${info.title} @ ${quality === "source" ? "SOURCE" : quality + " kbps"}`, "b");
    echo("  " + "─".repeat(46), "faint");

    // progress bar
    const wrap = document.createElement("div");
    wrap.className = "progress-wrap";
    const label = document.createElement("div");
    label.className = "progress-label";
    label.textContent = "acquiring stream...";
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
    scrollBottom();

    const HEX = "0123456789abcdef";
    function hexRow() {
        let r = "";
        for (let i = 0; i < 96; i++) r += HEX[Math.floor(Math.random() * 16)];
        hex.textContent = r;
    }

    const body = new URLSearchParams();
    body.set("url", "https://www.youtube.com/watch?v=" + info.id);
    body.set("quality", quality);

    try {
        const res = await fetch("api.php?action=convert", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });
        if (!res.ok || !res.body) {
            echo("[!] convert request failed (" + res.status + ")", "err");
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let pct = 0;
        let phase = "GRABBING";
        let doneFile = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) !== -1) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                let ev;
                try { ev = JSON.parse(line); } catch { continue; }
                if (ev.type === "progress") {
                    pct = ev.pct || 0;
                    phase = ev.phase || phase;
                    fill.style.width = pct + "%";
                    label.textContent = phase === "TRANSCODING"
                        ? `transcoding to ${quality === "source" ? "native" : "mp3 " + quality + "k"}... ${pct}%`
                        : `grabbing stream... ${pct}%`;
                    hexRow();
                } else if (ev.type === "log") {
                    echo(ev.line, "faint");
                    hexRow();
                } else if (ev.type === "done") {
                    doneFile = ev;
                    fill.style.width = "100%";
                    label.textContent = "complete";
                } else if (ev.type === "error") {
                    fill.style.width = "0%";
                    label.textContent = "failed";
                    echo("[!] " + (ev.message || "conversion failed"), "err");
                }
            }
            scrollBottom();
        }

        if (doneFile) {
            hex.textContent = "";
            sizeEl.textContent = doneFile.sizeTxt + " · " + (doneFile.kbps || "");
            const dl = document.createElement("a");
            dl.className = "result-btn";
            dl.href = "api.php?action=download&file=" + encodeURIComponent(doneFile.file);
            dl.textContent = "⬇ DOWNLOAD ." + (doneFile.ext || "bin").toUpperCase();
            row.appendChild(dl);
            if (doneFile.note) echo("[i] " + doneFile.note, "dim");
            echo(`[+] LIBERATED — ${doneFile.file} (${doneFile.sizeTxt})`, "ok");
            echo("    grab it again anytime with: dl " + info.id, "faint");
            jobs.push({ id: info.id, file: doneFile.file, size: doneFile.sizeTxt, title: info.title, kbps: doneFile.kbps });
            $("stJobs").textContent = "jobs: " + jobs.length;
        }
    } catch (e) {
        echo("[!] network error during conversion: " + e.message, "err");
    }
    scrollBottom();
}

/* ------------------------------------------------------------------ */
/* Command shell                                                       */
/* ------------------------------------------------------------------ */

const HELP = [
    "  AVAILABLE COMMANDS",
    "  " + "─".repeat(46),
    "  fetch <url>         resolve a YouTube link",
    "  grab <url> [q]      resolve + liberate (q: 64/128/192/320/source)",
    "  dl <id>             open download for last job of that video",
    "  jobs                list jobs this session",
    "  status              engine + folder health",
    "  clear               clear the screen",
    "  theme <name>        green | amber | cyan | magenta",
    "  banner              reprint the banner",
    "  whoami · date · uptime · sudo · id",
    "  " + "─".repeat(46),
    "  tip: paste a YouTube link into the prompt directly",
];

async function runCommand(raw) {
    const cmd = raw.trim();
    echo(`root@tubehax:~$ ${cmd}`, "dim");
    if (!cmd) return;

    const parts = cmd.split(/\s+/);
    const c = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    switch (c) {
        case "help":
            for (const l of HELP) echo(l, "dim");
            break;

        case "fetch":
            if (!arg) { echo("[!] usage: fetch <url>", "warn"); break; }
            await acquire(arg);
            break;

        case "grab":
            if (!arg) { echo("[!] usage: grab <url> [quality]", "warn"); break; }
            {
                const bits = arg.split(/\s+/);
                const url = bits[0];
                const q = bits[1];
                if (q && ["64", "128", "192", "320", "source"].includes(q)) selectedQuality = q;
                await acquire(url);
                if (currentInfo) await liberate(currentInfo, selectedQuality);
            }
            break;

        case "dl": {
            if (!arg) { echo("[!] usage: dl <id>", "warn"); break; }
            const job = [...jobs].reverse().find((j) => j.id === arg);
            if (!job) { echo("[!] no job for id '" + arg + "' — run grab first", "warn"); break; }
            window.open("api.php?action=download&file=" + encodeURIComponent(job.file), "_blank");
            break;
        }

        case "jobs":
            if (!jobs.length) { echo("[+] no jobs this session", "ok"); break; }
            for (const j of jobs) {
                echo(`  ${j.id}  ${j.kbps.padEnd(6)}  ${j.size.padEnd(10)}  ${j.title}`, "dim");
            }
            break;

        case "status":
            await refreshStatus();
            break;

        case "clear":
            output.textContent = "";
            printBanner(true);
            break;

        case "theme": {
            if (!arg) { echo("[!] usage: theme <green|amber|cyan|magenta>", "warn"); break; }
            const name = arg.toLowerCase();
            if (!["green", "amber", "cyan", "magenta"].includes(name)) {
                echo("[!] unknown theme", "warn");
                break;
            }
            document.body.dataset.theme = name;
            echo(`[+] phosphor set to ${name}`, "ok");
            break;
        }

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
            // bare URL → treat as fetch
            if (videoIdFromUrl(cmd)) {
                await acquire(cmd);
                break;
            }
            echo(`-bash: ${c}: command not found`, "err");
            echo("    type 'help' for available commands", "faint");
    }
    scrollBottom();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const BOOT_LINES = [
    ["[ OK ] initializing stream grabber", "ok"],
    ["[ OK ] mounting /dev/yt_audio", "ok"],
    ["[ OK ] loading cipher engine", "ok"],
    ["[ OK ] scanning for yt-dlp / ffmpeg", "dim"],
    ["[ OK ] terminal ready", "ok"],
];

async function boot() {
    printBanner(false);
    for (const [text, cls] of BOOT_LINES) {
        echo(text, cls);
        scrollBottom();
        await new Promise((r) => setTimeout(r, 120 + Math.random() * 150));
    }
    echo("");
    echo("> awaiting target...", "b");
    echo("  paste a YouTube link anywhere, or type 'help'", "faint");
    scrollBottom();
    await refreshStatus();
}

function printBanner(withSub) {
    const el = document.createElement("div");
    el.className = "banner";
    el.textContent = BANNER;
    output.appendChild(el);
    if (withSub) {
        echo("  YOUTUBE AUDIO LIBERATION TERMINAL v1.0", "dim");
        echo("", "dim");
    }
}

/* ------------------------------------------------------------------ */
/* Acquisition overlay + inputs                                        */
/* ------------------------------------------------------------------ */

function hideDropzone() {
    dropzone.classList.add("hidden");
    cmdInput.focus();
}

async function acquireFromInput() {
    const url = $("dzUrl").value.trim();
    $("dzErr").textContent = "";
    if (!videoIdFromUrl(url)) {
        $("dzErr").textContent = "that is not a valid YouTube link";
        return;
    }
    hideDropzone();
    await acquire(url);
}

$("dzGo").addEventListener("click", (e) => { e.stopPropagation(); acquireFromInput(); });
$("dzDemo").addEventListener("click", (e) => {
    e.stopPropagation();
    $("dzUrl").value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    $("dzErr").textContent = "demo target queued — press LIBERATE";
});
$("dzPaste").addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
        const txt = await navigator.clipboard.readText();
        if (txt) $("dzUrl").value = txt;
        $("dzErr").textContent = videoIdFromUrl($("dzUrl").value) ? "" : "clipboard text is not a YouTube link";
    } catch {
        $("dzErr").textContent = "clipboard blocked — paste manually (Ctrl+V)";
    }
});
$("dzUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); acquireFromInput(); }
    e.stopPropagation();
});

$("btnAcquire").addEventListener("click", () => { dropzone.classList.remove("hidden"); $("dzUrl").focus(); });
$("btnDemo").addEventListener("click", async () => {
    hideDropzone();
    await acquire("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
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
    const dzB = $("dzBanner");
    dzB.textContent = BANNER;
    boot();
    cmdInput.focus();
});

})();
