/* ============================================================
   TUBEMP3 — NODE ENGINE
   Self-hosted YouTube audio engine using youtubei.js
   (YouTube's InnerTube API — handles signature deciphering).

   api.php probes GET /health and proxies info/convert here
   when this server is running. Files land in data/out/ so
   PHP's download endpoint keeps working untouched.

   Run:  node server.js        (port 8777)
   ============================================================ */
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const https = require("https");
const { spawn } = require("child_process");

const PORT = 8777;
const OUT_DIR = path.join(__dirname, "data", "out");

const ffmpeg = require("fluent-ffmpeg");
const NodeID3 = require("node-id3");

// Prefer the ffmpeg binary bundled by @ffmpeg-installer/ffmpeg,
// fall back to one on PATH.
let FFMPEG_BIN = null;
try {
    FFMPEG_BIN = require("@ffmpeg-installer/ffmpeg").path;
} catch {
    FFMPEG_BIN = null;
}
if (FFMPEG_BIN) {
    ffmpeg.setFfmpegPath(FFMPEG_BIN);
}

// Optional yt-dlp fallback engine (drop yt-dlp.exe next to server.js).
// It defeats YouTube's "Sign in to confirm you're not a bot" checks far
// better than youtubei.js, especially when given a cookie profile.
let YTDLP_BIN = null;
for (const name of ["yt-dlp.exe", "yt-dlp"]) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) { YTDLP_BIN = p; break; }
}

// Dedicated Chrome cookie profile — one-time setup beats IP-level bot checks:
//   1. chrome.exe --user-data-dir="<tubemp3>/.ytprofile" https://www.youtube.com
//   2. log into YouTube (or just let the page load), close that window
//   3. the engine picks the cookies up automatically from then on
const COOKIE_PROFILE = path.join(__dirname, ".ytprofile");
const COOKIE_ARGS = (YTDLP_BIN && fs.existsSync(path.join(COOKIE_PROFILE, "Default", "Network", "Cookies")))
    ? ["--cookies-from-browser", "chrome:" + COOKIE_PROFILE]
    : [];

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const QUALITIES = ["64", "128", "192", "320", "source"];

let busy = false;

// youtubei.js is ESM — load it lazily via dynamic import (one shared session).
let ytPromise = null;
function getYT() {
    if (!ytPromise) {
        ytPromise = import("youtubei.js").then(({ Innertube }) =>
            Innertube.create({ locale: "en" })
        );
    }
    return ytPromise;
}

/** Drop the cached Innertube session so the next getYT() starts fresh. */
function resetYT() {
    ytPromise = null;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function sendJson(res, code, obj) {
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(obj));
}

function sendError(res, code, message) {
    sendJson(res, code, { ok: false, error: message });
}

function extractVideoId(raw) {
    let url = String(raw || "").trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let host;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
    if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return null;
    const m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
        || url.match(/[?&]v=([A-Za-z0-9_-]{11})/)
        || url.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    return m && YT_ID_RE.test(m[1]) ? m[1] : null;
}

function canonicalUrl(id) {
    return "https://www.youtube.com/watch?v=" + id;
}

function humanSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MiB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KiB";
    return bytes + " B";
}

/** Filesystem-safe version of a video title (Windows-friendly). */
function safeTitle(title, id) {
    let s = String(title || "")
        .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "");
    if (s === "" || s === "." || s === "..") s = String(id || "track");
    if (s.length > 100) s = s.slice(0, 100).trim().replace(/[. ]+$/g, "");
    return s;
}

function durationTxt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Map a YouTube mime type to a file extension. */
function extFromMime(mime) {
    const codec = String(mime || "").split(";")[0].trim().split("/")[1] || "";
    if (codec === "mp4") return "m4a";
    return codec || "m4a";
}

function isNetworkErr(msg) {
    return /fetch failed|aborted|timed out|ECONNRESET|socket hang up|dropped|EPIPE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg);
}

/** https.get that follows redirects and resolves with the IncomingMessage. */
function httpsGet(url, headers = {}, redirects = 6) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                "User-Agent": USER_AGENT,
                Referer: "https://www.youtube.com/",
                ...headers,
            },
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error("too many redirects"));
                return resolve(httpsGet(new URL(res.headers.location, url).href, headers, redirects - 1));
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return reject(new Error("stream request failed (HTTP " + res.statusCode + ")"));
            }
            resolve(res);
        });
        req.on("error", reject);
        req.setTimeout(90000, () => req.destroy(new Error("stream request timed out (no data for 90s)")));
    });
}

/** Fetch a URL into a Buffer (for album art), redirects followed. */
function fetchBuffer(url, timeoutMs = 20000) {
    return httpsGet(url, { Accept: "image/*" }).then((res) => new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
            size += c.length;
            if (size > 8 * 1024 * 1024) {
                res.destroy();
                return resolve(null);
            }
            chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", () => resolve(null));
    })).catch(() => null);
}

/* ------------------------------------------------------------------ */
/* Info                                                                */
/* ------------------------------------------------------------------ */

async function getInfoYtjs(id) {
    const yt = await getYT();
    const info = await yt.getBasicInfo(id, { retrieve_player: true });
    const b = info.basic_info || {};
    if (!b.title) {
        let reason = "";
        try {
            const ps = info.playability_status;
            if (ps) reason = String(ps.reason || ps.status || "");
        } catch {}
        throw new Error("YouTube blocked this video" + (reason ? " (" + reason + ")" : "") + " — sign-in/bot check from this network");
    }
    const af = (info.streaming_data && info.streaming_data.adaptive_formats) || [];

    const audio = af
        .filter((f) => f.has_audio && !f.has_video)
        .map((f) => ({
            ext: extFromMime(f.mime_type),
            abr: Math.round((f.bitrate || 0) / 1000),
            tbr: Math.round((f.bitrate || 0) / 1000),
            note: String(f.audio_quality || ""),
        }))
        .sort((a, c) => c.tbr - a.tbr);

    const thumbs = (b.thumbnail && b.thumbnail.length) ? b.thumbnail : [];
    const d = Number(b.duration || 0);
    return {
        ok: true,
        id,
        title: String(b.title || "untitled"),
        channel: String(b.author || "unknown"),
        duration: d,
        durationTxt: durationTxt(d),
        thumb: thumbs.length ? String(thumbs[thumbs.length - 1].url || "") : "",
        views: Number(b.view_count || 0),
        audio: audio.slice(0, 4),
        engine: "node",
    };
}

/* ------------------------------------------------------------------ */
/* yt-dlp fallback engine                                              */
/* ------------------------------------------------------------------ */

/** Append a one-line fix hint when a failure smells like YouTube's bot check. */
function botHint(msg) {
    return /sign in|not a bot|bot check/i.test(String(msg))
        ? " — FIX: log into YouTube once in the tool's cookie profile (double-click open-cookie-profile.bat inside tubemp3/, log in, then close that window) and retry."
        : "";
}

function ytdlpBaseArgs() {
    const args = [
        YTDLP_BIN,
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificate",
        "--no-mtime",
        "--newline",
        "--sleep-requests", "1",
        "--sleep-interval", "2",
        "--max-sleep-interval", "5",
        "--js-runtimes", "node",
    ];
    if (FFMPEG_BIN) args.push("--ffmpeg-location", path.dirname(FFMPEG_BIN));
    if (COOKIE_ARGS.length) args.push(...COOKIE_ARGS);
    return args;
}

function ytdlpInfo(id) {
    return new Promise((resolve, reject) => {
        const args = ytdlpBaseArgs().concat(["--skip-download", "--dump-single-json", canonicalUrl(id)]);
        const proc = spawn(args[0], args.slice(1), { windowsHide: true });
        let stdout = "", stderr = "";
        proc.stdout.on("data", (c) => { stdout += c; });
        proc.stderr.on("data", (c) => { stderr += c; });
        proc.on("error", (e) => reject(new Error("could not start yt-dlp: " + e.message)));
        proc.on("close", (code) => {
            let data = null;
            try { data = JSON.parse(stdout); } catch {}
            if (code !== 0 || !data || !data.id) {
                return reject(new Error("yt-dlp could not resolve this video: " + stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 200)));
            }
            const audio = (data.formats || [])
                .filter((f) => String(f.acodec || "none") !== "none" && String(f.vcodec || "none") === "none")
                .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))
                .slice(0, 4)
                .map((f) => ({
                    ext: String(f.ext || "?"),
                    abr: Math.round(Number(f.abr || f.tbr || 0)),
                    tbr: Math.round(Number(f.tbr || 0)),
                    note: String(f.format_note || ""),
                }));
            const d = Number(data.duration || 0);
            resolve({
                ok: true,
                id,
                title: String(data.title || "untitled"),
                channel: String(data.channel || data.uploader || "unknown"),
                duration: d,
                durationTxt: durationTxt(d),
                thumb: String(data.thumbnail || ""),
                views: Number(data.view_count || 0),
                audio,
                engine: "yt-dlp",
            });
        });
    });
}

/**
 * Public info lookup: youtubei.js first, one fresh-session retry (bot
 * checks are often transient), then the yt-dlp fallback engine.
 */
async function getInfo(id) {
    try {
        return await getInfoYtjs(id);
    } catch (e) {
        const msg = (e && e.message) || String(e);
        try {
            resetYT();
            return await getInfoYtjs(id);
        } catch (e2) {
            if (YTDLP_BIN) {
                try {
                    return await ytdlpInfo(id);
                } catch (e3) {
                    throw new Error(msg + " — yt-dlp fallback failed: " + ((e3 && e3.message) || e3) + botHint(msg + " " + ((e3 && e3.message) || "")));
                }
            }
            throw e2;
        }
    }
}

function ytdlpConvert(id, quality, res) {
    return new Promise((resolve, reject) => {
        const out = path.join(OUT_DIR, "%(title)s.%(ext)s");
        const jobStart = Date.now();
        const args = ytdlpBaseArgs().concat(["-o", out]);
        if (quality === "source") {
            args.push("-f", "bestaudio/best");
        } else {
            // bestaudio, else cap the video+audio fallback at 360p so we are
            // not pulling a huge file just to extract the audio track.
            args.push("-f", "bestaudio/best[height<=360]/best", "-x", "--audio-format", "mp3", "--audio-quality", quality + "K");
        }
        args.push(canonicalUrl(id));

        const proc = spawn(args[0], args.slice(1), { windowsHide: true });
        let phase = "GRABBING";
        let stderrTail = "";

        const onLine = (line) => {
            const t = String(line).trim();
            if (!t) return;
            if (/\[ExtractAudio\]|\[ffmpeg\]|\[Merger\]|\[VideoConvertor\]/.test(t) && phase !== "TRANSCODING") {
                phase = "TRANSCODING";
                ndjson(res, { type: "progress", pct: 95, phase, line: t });
                return;
            }
            const m = t.match(/(\d+(?:\.\d+)?)%/);
            if (m && /download/i.test(t)) {
                ndjson(res, { type: "progress", pct: Math.min(99, Math.round(parseFloat(m[1]))), phase, line: t });
            } else {
                ndjson(res, { type: "log", phase, line: t });
            }
        };

        proc.stdout.on("data", (c) => String(c).split("\n").forEach(onLine));
        proc.stderr.on("data", (c) => {
            stderrTail = (stderrTail + String(c)).slice(-800);
            String(c).split("\n").forEach(onLine);
        });
        proc.on("error", (e) => reject(new Error("could not start yt-dlp: " + e.message)));
        proc.on("close", (code) => {
            let found = null;
            try {
                // Output is title-named now — pick the newest file this job wrote.
                let best = 0;
                for (const f of fs.readdirSync(OUT_DIR)) {
                    if (f.endsWith(".part") || f.endsWith(".ytdl")) continue;
                    const fp = path.join(OUT_DIR, f);
                    let st;
                    try { st = fs.statSync(fp); } catch { continue; }
                    if (st.mtimeMs >= jobStart - 5000 && st.mtimeMs >= best) {
                        best = st.mtimeMs;
                        found = f;
                    }
                }
            } catch {}
            if (code !== 0 || !found) {
                const tail = stderrTail.trim().split("\n").slice(-2).join(" | ").slice(0, 220);
                return reject(new Error("yt-dlp failed (exit " + code + "): " + (tail || "no output")));
            }
            const ext = found.split(".").pop().toLowerCase();
            const size = fs.statSync(path.join(OUT_DIR, found)).size;
            ndjson(res, {
                type: "done",
                file: found,
                ext,
                size,
                sizeTxt: humanSize(size),
                kbps: quality === "source" ? "SOURCE" : quality + "k",
                note: quality === "source" && ext !== "mp3" ? "native stream via yt-dlp — pick an MP3 quality for converted audio" : `mp3 ${quality}k via yt-dlp`,
            });
            resolve();
        });
    });
}

/* ------------------------------------------------------------------ */
/* Convert — NDJSON stream                                             */
/* ------------------------------------------------------------------ */

function ndjson(res, obj) {
    res.write(JSON.stringify(obj) + "\n");
}

/**
 * One full conversion pass. Throws on failure (partial file cleaned up).
 * Network-flaky machines retry the whole pass once via handleConvert.
 */
async function doConvertYtjs(id, quality, res) {
    let filePath = null;
    try {
        const yt = await getYT();
        const info = await getInfoYtjs(id);
        const title = info.title;

        // Deciphered direct download URL for the best audio stream.
        // IOS client exposes decipherable URLs (WEB/ANDROID responses carry none).
        const sd = await yt.getStreamingData(id, { type: "audio", quality: "best", client: "IOS", retrieve_player: true });
        if (!sd || !sd.url) throw new Error("no downloadable audio stream exposed for this video");

        let ext;
        if (quality === "source") {
            ext = extFromMime(sd.mime_type);
            filePath = path.join(OUT_DIR, `${id}.${ext}`);
            const part = filePath + ".part";
            ndjson(res, { type: "progress", pct: 1, phase: "GRABBING" });
            if (!(await downloadWithResume(sd.url, part, res))) {
                throw new Error("connection dropped mid-stream (retries exhausted)");
            }
            fs.renameSync(part, filePath);
        } else {
            const kbps = Number(quality);
            ext = "mp3";
            filePath = path.join(OUT_DIR, `${id}.mp3`);
            const part = path.join(OUT_DIR, `${id}.audio.part`);
            ndjson(res, { type: "progress", pct: 2, phase: "GRABBING" });
            if (!(await downloadWithResume(sd.url, part, res))) {
                throw new Error("connection dropped mid-stream (retries exhausted)");
            }
            // Transcode the completed file locally (no network involved).
            ndjson(res, { type: "log", phase: "GRABBING", line: `[i] downloaded ${humanSize(fs.statSync(part).size)} · ${sd.mime_type || "?"}` });
            ndjson(res, { type: "progress", pct: 90, phase: "TRANSCODING" });
            await transcodeToMp3(part, kbps, filePath, res);
            try { fs.unlinkSync(part); } catch {}
        }

        // MP3 only: ID3 tags + embedded cover art — the bots' cool feature.
        if (quality !== "source") {
            try {
                const thumbUrl = String(info.thumb || "");
                const thumbBuf = thumbUrl ? await fetchBuffer(thumbUrl) : null;
                const tags = {
                    title,
                    artist: info.channel,
                    album: "YouTube",
                    year: "",
                };
                if (thumbBuf && thumbBuf.length > 100) {
                    tags.image = {
                        mime: "jpeg",
                        type: { id: 3, name: "front cover" },
                        imageBuffer: thumbBuf,
                        description: "Cover of " + title,
                    };
                }
                await NodeID3.write(tags, filePath);
            } catch {
                // tags are a bonus — never fail the job over them
            }
        }

        // Save under the video's real title (filesystem-safe) instead of its ID.
        try {
            const titled = path.join(OUT_DIR, safeTitle(title, id) + "." + ext);
            fs.renameSync(filePath, titled);
            filePath = titled;
        } catch { /* keep the id-based name if the rename fails */ }

        const size = fs.statSync(filePath).size;
        ndjson(res, {
            type: "done",
            file: path.basename(filePath),
            ext,
            size,
            sizeTxt: humanSize(size),
            kbps: quality === "source" ? "SOURCE" : quality + "k",
            note: quality === "source"
                ? "native stream via NODE engine — pick an MP3 quality for converted audio"
                : `mp3 ${quality}k · ID3 tags embedded`,
        });
        res.end();
    } catch (e) {
        // clean up partial download (mp3 job) / partial output
        try { fs.unlinkSync(path.join(OUT_DIR, `${id}.audio.part`)); } catch {}
        try { fs.unlinkSync(path.join(OUT_DIR, `${id}.mp3.part`)); } catch {}
        if (filePath) {
            try { fs.unlinkSync(filePath); } catch { /* already gone */ }
        }
        throw e;
    }
}

/**
 * Full conversion: youtubei.js first, then the yt-dlp fallback engine
 * when YouTube bot-checks the request.
 */
async function doConvert(id, quality, res) {
    try {
        await doConvertYtjs(id, quality, res);
    } catch (e) {
        const msg = (e && e.message) || String(e);
        if (YTDLP_BIN) {
            ndjson(res, { type: "log", phase: "GRABBING", line: "[!] " + msg });
            ndjson(res, { type: "log", phase: "GRABBING", line: "[!] switching to yt-dlp engine..." });
            try {
                await ytdlpConvert(id, quality, res);
                return;
            } catch (e2) {
                throw new Error("yt-dlp fallback failed: " + ((e2 && e2.message) || e2) + botHint(msg + " " + ((e2 && e2.message) || "")));
            }
        }
        throw e;
    }
}

async function handleConvert(res, body) {
    const id = extractVideoId(body.url || "");
    if (!id) return sendError(res, 400, "not a valid YouTube link.");

    const quality = String(body.quality || "128");
    if (!QUALITIES.includes(quality)) {
        return sendError(res, 400, "quality must be 64, 128, 192, 320 or source");
    }

    if (busy) {
        return sendError(res, 409, "engine busy — one conversion at a time");
    }
    busy = true;

    res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    });
    ndjson(res, { type: "start", id, quality });

    try {
        await doConvert(id, quality, res);
    } catch (e) {
        const msg = (e && e.message) || String(e);
        if (isNetworkErr(msg)) {
            // Slow/flaky networks: one full retry before giving up.
            ndjson(res, { type: "log", phase: "GRABBING", line: "[!] " + msg + " — retrying..." });
            try {
                await doConvert(id, quality, res);
            } catch (e2) {
                ndjson(res, { type: "error", message: "conversion failed: " + ((e2 && e2.message) || e2) });
                res.end();
            }
        } else {
            ndjson(res, { type: "error", message: "conversion failed: " + msg });
            res.end();
        }
    } finally {
        busy = false;
    }
}

/**
 * Download a URL to a file with HTTP Range resume — survives this
 * machine's mid-transfer connection drops by retrying from the last
 * byte received. Reports GRABBING progress. Resolves true when the
 * file is complete, false when retries are exhausted.
 */
async function downloadWithResume(url, destPart, res) {
    let start = 0;
    try { start = fs.statSync(destPart).size; } catch { /* fresh download */ }

    for (let attempt = 0; attempt < 10; attempt++) {
        if (attempt > 0) {
            ndjson(res, { type: "log", phase: "GRABBING", line: `[!] resuming from byte ${start}...` });
            await new Promise((r) => setTimeout(r, 1500));
        }

        const result = await new Promise((resolve, reject) => {
            httpsGet(url, { Range: `bytes=${start}-` }).then((stream) => {
                let total;
                if (stream.statusCode === 206) {
                    const m = /bytes \d+-\d+\/(\d+)/.exec(String(stream.headers["content-range"] || ""));
                    total = m ? Number(m[1]) : start + Number(stream.headers["content-length"] || 0);
                } else {
                    // Server ignored Range (200) — restart from scratch.
                    total = start + Number(stream.headers["content-length"] || 0);
                    if (start > 0) start = 0;
                }

                const fd = fs.openSync(destPart, "a");
                let got = 0;
                let last = 0;
                stream.on("data", (c) => {
                    fs.writeSync(fd, c);
                    got += c.length;
                    if (Date.now() - last >= 200) {
                        last = Date.now();
                        const pct = total > 0 ? Math.min(90, Math.round(((start + got) / total) * 90)) : 0;
                        ndjson(res, { type: "progress", pct, phase: "GRABBING" });
                    }
                });
                stream.on("end", () => {
                    try { fs.closeSync(fd); } catch {}
                    resolve({ total, complete: start + got >= total });
                });
                stream.on("aborted", () => {
                    try { fs.closeSync(fd); } catch {}
                    resolve({ total, complete: false });
                });
                stream.on("error", (e) => {
                    try { fs.closeSync(fd); } catch {}
                    reject(e);
                });
            }).catch(reject);
        });

        if (result.complete) return true;
        start = fs.statSync(destPart).size; // resume position
        if (start >= result.total) return true;
    }
    return false;
}

/** ffmpeg: local file -> MP3 at kbps. Progress mapped into 90-99%. */
function transcodeToMp3(input, kbps, dest, res) {
    return new Promise((resolve, reject) => {
        let last = 0;
        ffmpeg(input)
            .audioFrequency(44100)
            .audioChannels(2)
            .audioBitrate(kbps)
            .audioCodec("libmp3lame")
            .audioQuality(2)
            .format("mp3")
            .outputOptions(["-id3v2_version", "3"])
            .on("progress", (p) => {
                if (Date.now() - last < 200) return;
                last = Date.now();
                const pct = p.percent != null ? Math.min(99, 90 + Math.round(p.percent * 0.09)) : 95;
                ndjson(res, { type: "progress", pct, phase: "TRANSCODING" });
            })
            .on("end", () => resolve())
            .on("error", (e) => reject(new Error("ffmpeg: " + e.message + (e.stderr && e.stderr.length ? " :: " + e.stderr.slice(-4).join(" | ") : ""))))
            .save(dest);
    });
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:" + PORT);

    if (url.pathname === "/health") {
        return sendJson(res, 200, {
            ok: true,
            engine: "NODE",
            ffmpeg: !!FFMPEG_BIN,
            ffmpegBin: FFMPEG_BIN ? path.basename(FFMPEG_BIN) : null,
            busy,
            qualities: QUALITIES,
            outWritable: (() => {
                try {
                    fs.mkdirSync(OUT_DIR, { recursive: true });
                    fs.accessSync(OUT_DIR, fs.constants.W_OK);
                    return true;
                } catch {
                    return false;
                }
            })(),
        });
    }

    if (url.pathname === "/info") {
        const id = extractVideoId(url.searchParams.get("url") || "");
        if (!id || !YT_ID_RE.test(id)) {
            return sendError(res, 400, "not a valid YouTube link. Accepts youtube.com/watch, youtu.be, /shorts/, /embed/.");
        }
        try {
            const info = await getInfo(id);
            return sendJson(res, 200, info);
        } catch (e) {
            return sendError(res, 422, "could not resolve this video: " + ((e && e.message) || e));
        }
    }

    if (url.pathname === "/convert" && req.method === "POST") {
        let raw = "";
        req.on("data", (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
        req.on("end", async () => {
            let body = {};
            try { body = JSON.parse(raw || "{}"); } catch { /* fall through */ }
            await handleConvert(res, body);
        });
        return;
    }

    return sendError(res, 404, "not found. Try /health, /info?url=..., POST /convert");
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`[tubemp3-node] listening on 127.0.0.1:${PORT}`);
    console.log(`[tubemp3-node] out dir: ${OUT_DIR}`);
    console.log(`[tubemp3-node] ffmpeg: ${FFMPEG_BIN || "NOT FOUND (MP3 qualities unavailable, source still works)"}`);
});
