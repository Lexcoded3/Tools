/* ============================================================
   IMGINTEL — Picture Intelligence Terminal
   Extract the secrets out of an uploaded image:
   · true file format (magic-byte sniffing, mismatch detection)
   · dimensions via native format parsers (PNG/GIF/WebP/BMP/
     TIFF/ICO/JPEG — no libraries)
   · EXIF metadata parser written from scratch (JPEG APP1 →
     TIFF IFD0 / ExifIFD / GPSIFD) — no libraries
   · embedded QR / barcodes — native BarcodeDetector when
     available, jsQR (CDN) as fallback
   · OCR via Tesseract.js (CDN, lazy-loaded on first use)
   · dominant color palette + SHA-256 hash (secure contexts)
   ============================================================ */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }

/* ------------------------------------------------------------------ */
/* Lazy CDN loading (jsDelivr, family pattern)                         */
/* ------------------------------------------------------------------ */

const TESS_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const JSQR_CDN = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

let tessPromise = null, jsqrPromise = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        const timer = setTimeout(() => {
            s.onload = s.onerror = null;
            reject(new Error("timed out loading " + src + " — check your internet / CDN access"));
        }, 20000);
        s.onload = () => { clearTimeout(timer); resolve(); };
        s.onerror = () => { clearTimeout(timer); reject(new Error("could not load " + src + " from CDN — this needs internet on first use")); };
        document.head.appendChild(s);
    });
}

function loadTesseract() {
    if (!tessPromise) tessPromise = loadScript(TESS_CDN);
    return tessPromise;
}

function loadJsqr() {
    if (!jsqrPromise) jsqrPromise = loadScript(JSQR_CDN);
    return jsqrPromise;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
}

/* ------------------------------------------------------------------ */
/* True file format — magic-byte sniffing                              */
/* ------------------------------------------------------------------ */

function sniffFormat(buf) {
    const b = new Uint8Array(buf);
    const n = b.length;
    const eq = (off, hex) => {
        const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
        if (off + bytes.length > n) return false;
        for (let i = 0; i < bytes.length; i++) if (b[off + i] !== bytes[i]) return false;
        return true;
    };
    if (eq(0, "FFD8FF")) return { fmt: "JPEG", ext: "jpg", mime: "image/jpeg" };
    if (eq(0, "89504E470D0A1A0A")) return { fmt: "PNG", ext: "png", mime: "image/png" };
    if (eq(0, "474946383761") || eq(0, "474946383961")) return { fmt: "GIF", ext: "gif", mime: "image/gif" };
    if (eq(0, "52494646") && eq(8, "57454250")) return { fmt: "WebP", ext: "webp", mime: "image/webp" };
    if (eq(0, "424D")) return { fmt: "BMP", ext: "bmp", mime: "image/bmp" };
    if (eq(0, "49492A00") || eq(0, "4D4D002A")) return { fmt: "TIFF", ext: "tiff", mime: "image/tiff" };
    if (eq(0, "00000100")) return { fmt: "ICO", ext: "ico", mime: "image/x-icon" };
    if (eq(4, "66747970")) {
        const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
        if (brand === "avif" || brand === "avis") return { fmt: "AVIF", ext: "avif", mime: "image/avif" };
        if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "mif1") return { fmt: "HEIC", ext: "heic", mime: "image/heic" };
        return { fmt: "ISOBMFF (" + brand + ")", ext: "bin", mime: "application/octet-stream" };
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Native dimension parsers                                            */
/* ------------------------------------------------------------------ */

function pngDims(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const w = dv.getUint32(16), h = dv.getUint32(20);
    const bit = dv.getUint8(24), ct = dv.getUint8(25);
    const colorNames = { 0: "grayscale", 2: "RGB", 3: "palette", 4: "grayscale+alpha", 6: "RGBA" };
    return { w, h, extra: { "bit depth": bit + " bit", "color type": colorNames[ct] || ct } };
}

function gifDims(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const w = dv.getUint16(6, true), h = dv.getUint16(8, true);
    const palette = (b[10] & 0x80) ? (1 << ((b[10] & 0x07) + 1)) : 0;
    const anim = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]) === "GIF89a";
    return { w, h, extra: { palette: palette ? palette + " colors" : "—", frames: anim ? "animated" : "static" } };
}

function webpDims(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === "VP8X") {
        const w = 1 + (b[20] | (b[21] << 8) | (b[22] << 16));
        const h = 1 + (b[23] | (b[24] << 8) | (b[25] << 16));
        return { w, h, extra: { variant: "VP8X (extended)" } };
    }
    if (tag === "VP8L") {
        const bits = b[17] | (b[18] << 8) | (b[19] << 16) | (b[20] << 24);
        const w = 1 + (bits & 0x3FFF);
        const h = 1 + ((bits >> 14) & 0x3FFF);
        return { w, h, extra: { variant: "VP8L (lossless)" } };
    }
    if (tag === "VP8 " && b[16] === 0x9D && b[17] === 0x01 && b[18] === 0x2A) {
        const w = dv.getUint16(19, true) & 0x3FFF;
        const h = dv.getUint16(21, true) & 0x3FFF;
        return { w, h, extra: { variant: "VP8 (lossy)" } };
    }
    return null;
}

function bmpDims(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const w = Math.abs(dv.getInt32(18, true)), h = Math.abs(dv.getInt32(22, true));
    const bpp = dv.getUint16(28, true);
    return { w, h, extra: { "bits/pixel": bpp } };
}

function icoDims(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const count = dv.getUint16(4, true);
    const w = b[6] === 0 ? 256 : b[6], h = b[7] === 0 ? 256 : b[7];
    const bpp = dv.getUint16(10, true);
    return { w, h, extra: { "frames/icons": count, "bits/pixel": bpp } };
}

function tiffDims(b) {
    // minimal IFD0 walk for ImageWidth / ImageLength
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const little = dv.getUint16(0) === 0x4949;
    const g16 = (o) => dv.getUint16(o, little);
    const g32 = (o) => dv.getUint32(o, little);
    if (g16(2) !== 42) return null;
    const ifd0 = g32(4);
    const count = g16(ifd0);
    let w = null, h = null;
    for (let i = 0; i < count; i++) {
        const p = ifd0 + 2 + i * 12;
        const tag = g16(p), type = g16(p + 2);
        if (tag === 0x0100 && type === 4) w = g32(p + 8);
        if (tag === 0x0101 && type === 4) h = g32(p + 8);
    }
    if (w === null || h === null) return null;
    return { w, h, extra: { variant: "TIFF" } };
}

function jpegDims(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let off = 2;
    while (off + 9 <= b.length) {
        if (b[off] !== 0xFF) { off++; continue; }
        const m = b[off + 1];
        if (m === 0xDA || m === 0xD9) break; // SOS / EOI
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
            const h = dv.getUint16(off + 5), w = dv.getUint16(off + 7);
            const names = { 0xC0: "baseline", 0xC1: "extended", 0xC2: "progressive", 0xC3: "lossless", 0xC5: "differential", 0xC6: "progressive", 0xC7: "lossless", 0xC9: "extended", 0xCA: "progressive", 0xCB: "lossless", 0xCD: "differential", 0xCE: "differential", 0xCF: "differential" };
            return { w, h, extra: { variant: names[m] || ("SOF" + m.toString(16)) } };
        }
        off += 2 + dv.getUint16(off + 2);
    }
    return null;
}

function parseDims(buf, fmt) {
    const b = new Uint8Array(buf);
    try {
        switch (fmt) {
            case "PNG": return pngDims(b);
            case "GIF": return gifDims(b);
            case "WebP": return webpDims(b);
            case "BMP": return bmpDims(b);
            case "ICO": return icoDims(b);
            case "TIFF": return tiffDims(b);
            case "JPEG": return jpegDims(b);
            default: return null;
        }
    } catch (e) { return null; }
}

/* ------------------------------------------------------------------ */
/* EXIF parser — from scratch, no libraries                            */
/* JPEG APP1 → TIFF: IFD0 + ExifIFD + GPSIFD                           */
/* ------------------------------------------------------------------ */

const EXIF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function toDataView(buf) {
    if (buf instanceof ArrayBuffer) return new DataView(buf);
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

function parseTiff(buf, start) {
    const dv = toDataView(buf);
    const little = dv.getUint16(start) === 0x4949;
    const g8 = (o) => dv.getUint8(o);
    const g16 = (o) => dv.getUint16(o, little);
    const g32 = (o) => dv.getUint32(o, little);
    if (g16(start + 2) !== 42) return null;

    const res = { ifd: {}, exif: {}, gps: {} };

    function readValue(entryOff, type, count) {
        const size = (EXIF_TYPE_SIZE[type] || 1) * count;
        let p = entryOff + 8;
        if (size > 4) p = start + g32(entryOff + 8);
        if (type === 2) {
            let s = "", q = p;
            while (q < buf.byteLength && g8(q) !== 0 && (q - p) < count) { s += String.fromCharCode(g8(q)); q++; }
            return s;
        }
        const step = EXIF_TYPE_SIZE[type] || 1;
        const out = [];
        for (let i = 0; i < count; i++) {
            const at = p + i * step;
            switch (type) {
                case 1: case 7: out.push(g8(at)); break;
                case 3: out.push(g16(at)); break;
                case 4: case 9: out.push(g32(at)); break;
                case 5: case 10: {
                    const den = g32(at + 4);
                    out.push(den === 0 ? 0 : g32(at) / den);
                    break;
                }
                default: out.push(0);
            }
        }
        return count === 1 ? out[0] : out;
    }

    function readIFD(off, target, depth) {
        if (depth > 4 || off + 2 > buf.byteLength) return;
        const count = g16(off);
        let p = off + 2;
        for (let i = 0; i < count && p + 12 <= buf.byteLength; i++) {
            const tag = g16(p), type = g16(p + 2), n = g32(p + 4);
            if (EXIF_TYPE_SIZE[type]) {
                const v = readValue(p, type, n);
                if (tag === 0x8769 && typeof v === "number") readIFD(start + v, res.exif, depth + 1);
                else if (tag === 0x8825 && typeof v === "number") readIFD(start + v, res.gps, depth + 1);
                else if (type === 2) { if (typeof v === "string" && v !== "") target[tag] = v; }
                else if (typeof v === "number" || Array.isArray(v)) target[tag] = v;
            }
            p += 12;
        }
    }

    readIFD(start + g32(start + 4), res.ifd, 0);
    return res;
}

function parseExif(buf) {
    const dv = toDataView(buf);
    if (buf.byteLength < 4) return null;
    if (dv.getUint8(0) === 0xFF && dv.getUint8(1) === 0xD8) {
        let off = 2;
        while (off + 4 <= buf.byteLength) {
            if (dv.getUint8(off) !== 0xFF) break;
            const marker = dv.getUint8(off + 1);
            if (marker === 0xDA || marker === 0xD9) break; // SOS / EOI
            const len = dv.getUint16(off + 2);
            if (marker === 0xE1 && off + 10 <= buf.byteLength &&
                dv.getUint32(off + 4) === 0x45786966 && dv.getUint16(off + 8) === 0) {
                return parseTiff(buf, off + 10);
            }
            off += 2 + len;
        }
        return null;
    }
    // standalone TIFF (rare) — try it directly
    return parseTiff(buf, 0);
}

const ORIENT = { 1: "normal", 2: "flip horizontal", 3: "rotate 180°", 4: "flip vertical", 5: "transpose", 6: "rotate 90° CW", 7: "transverse", 8: "rotate 90° CCW" };

function fmtExposure(v) {
    if (!v) return null;
    if (v >= 1) return (+v).toFixed(v >= 10 ? 0 : 1) + " s";
    return "1/" + Math.round(1 / v) + " s";
}

function fmtFlash(v) {
    return (v & 1) === 1 ? "fired" : "did not fire";
}

function fmtExif(r) {
    if (!r) return [];
    const ifd = r.ifd || {}, ex = r.exif || {};
    const out = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== "") out.push([k, String(v)]); };
    add("CAMERA", [ifd[0x010F], ifd[0x0110]].filter(Boolean).join(" "));
    add("SOFTWARE", ifd[0x0131]);
    add("DESCRIPTION", ifd[0x010E]);
    add("DATETIME", ex[0x9003] || ifd[0x0132]);
    if (ex[0x829A]) add("EXPOSURE", fmtExposure(ex[0x829A]));
    if (ex[0x829D]) add("APERTURE", "f/" + (+ex[0x829D]).toFixed(1));
    if (ex[0x8827]) add("ISO", String(ex[0x8827]));
    if (ex[0x920A]) add("FOCAL LENGTH", (+ex[0x920A]).toFixed(1) + " mm");
    if (ex[0xA405]) add("35MM EQUIV", ex[0xA405] + " mm");
    if (ex[0x9209] !== undefined) add("FLASH", fmtFlash(ex[0x9209]));
    add("LENS", ex[0xA434]);
    if (ifd[0x0112]) add("ORIENTATION", ORIENT[ifd[0x0112]] || ifd[0x0112]);
    add("ARTIST", ifd[0x013B]);
    add("COPYRIGHT", ifd[0x8298]);
    return out;
}

function fmtGps(g) {
    if (!g) return null;
    const latArr = g[2], lonArr = g[4];
    if (!Array.isArray(latArr) || !Array.isArray(lonArr)) return null;
    const toDec = (arr, ref) => {
        const d = Math.abs(arr[0]) + Math.abs(arr[1]) / 60 + Math.abs(arr[2]) / 3600;
        return (ref === "S" || ref === "W") ? -d : d;
    };
    const lat = toDec(latArr, g[1]), lon = toDec(lonArr, g[3]);
    const dms = (dec) => {
        const abs = Math.abs(dec), d = Math.floor(abs), m = Math.floor((abs - d) * 60);
        const s = ((abs - d) * 60 - m) * 60;
        return d + "°" + m + "′" + s.toFixed(1) + "″";
    };
    let when = null;
    if (g[29]) { // GPSDateStamp = tag 0x001D
        when = String(g[29]).replace(/:/g, "-");
        if (Array.isArray(g[7])) {
            const t = g[7].map((x) => pad(Math.round(x)));
            when += " " + t.join(":") + " UTC";
        }
    }
    return {
        lat, lon,
        latDms: dms(lat), lonDms: dms(lon),
        alt: g[6] !== undefined ? (+g[6]).toFixed(1) + " m" + (g[5] === 1 ? " (below sea level)" : "") : null,
        when,
        link: "https://www.openstreetmap.org/?mlat=" + lat.toFixed(6) + "&mlon=" + lon.toFixed(6) + "#map=16/" + lat.toFixed(6) + "/" + lon.toFixed(6),
    };
}

/* ------------------------------------------------------------------ */
/* Hashing (secure contexts only)                                      */
/* ------------------------------------------------------------------ */

async function sha256(buf) {
    try {
        if (!(globalThis.crypto && globalThis.crypto.subtle)) return null;
        const d = await crypto.subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
    } catch (e) { return null; }
}

/* ------------------------------------------------------------------ */
/* Dominant color palette                                              */
/* ------------------------------------------------------------------ */

function extractPalette(imgEl) {
    const c = document.createElement("canvas");
    const size = 64;
    c.width = size; c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const scale = Math.min(1, size / imgEl.naturalWidth, size / imgEl.naturalHeight);
    const w = Math.max(1, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(1, Math.round(imgEl.naturalHeight * scale));
    ctx.drawImage(imgEl, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const buckets = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const b = buckets.get(key);
        if (b) { b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; }
        else buckets.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
        total++;
    }
    if (!total) return [];
    return Array.from(buckets.values())
        .sort((a, b2) => b2.n - a.n)
        .slice(0, 8)
        .map((b) => {
            const r = Math.round(b.r / b.n), g = Math.round(b.g / b.n), bl = Math.round(b.b / b.n);
            const hex = "#" + [r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("");
            return { hex, pct: Math.round((b.n / total) * 100) };
        });
}

/* ------------------------------------------------------------------ */
/* Embedded QR / barcodes                                              */
/* ------------------------------------------------------------------ */

const BD_FORMATS = ["qr_code", "aztec", "data_matrix", "pdf417", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "codabar", "itf"];

async function detectCodes(imgEl) {
    const results = [];
    if (window.BarcodeDetector) {
        try {
            const det = new window.BarcodeDetector({ formats: BD_FORMATS });
            const codes = await det.detect(imgEl);
            codes.forEach((c) => { if (c.rawValue) results.push({ type: c.format, value: c.rawValue }); });
        } catch (e) { /* unsupported formats etc — fall through to jsQR */ }
    }
    if (results.length === 0) {
        try {
            await loadJsqr();
            const c = document.createElement("canvas");
            const scale = Math.min(1, 1200 / imgEl.naturalWidth);
            c.width = Math.max(1, Math.round(imgEl.naturalWidth * scale));
            c.height = Math.max(1, Math.round(imgEl.naturalHeight * scale));
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(imgEl, 0, 0, c.width, c.height);
            const data = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" });
            if (code && code.data) results.push({ type: "QR_CODE", value: code.data });
        } catch (e) { /* CDN offline — no codes decoded */ }
    }
    return results;
}

/* ------------------------------------------------------------------ */
/* OCR — Tesseract.js, lazy CDN                                        */
/* ------------------------------------------------------------------ */

async function runOcr() {
    if (!currentFile) return;
    const btn = $("btnOcr"), prog = $("ocrProg"), out = $("ocrOut");
    if (!prog || !out) {
        $("stInfo").textContent = "✗ no OCR panel — analyze an image first";
        return;
    }
    btn.disabled = true;
    prog.textContent = "loading tesseract engine (first use pulls ~2 MB from CDN)...";
    $("stInfo").textContent = "ocr: loading engine";
    try {
        await loadTesseract();
    } catch (err) {
        prog.textContent = "✗ " + err.message;
        btn.disabled = false;
        return;
    }
    try {
        // NOTE: paths are pinned on purpose — tesseract.js's *default* language
        // host (tessdata.projectnaptha.com) is dead, which made OCR hang at the
        // "loading language traineddata" step. These jsDelivr URLs are verified
        // live and were tested end-to-end in headless Chrome.
        const worker = await Tesseract.createWorker("eng", 1, {
            logger: (m) => {
                if (m && m.status) {
                    const pct = Math.round((m.progress || 0) * 100);
                    prog.textContent = m.status + (pct ? " — " + pct + "%" : "");
                }
            },
            workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
            corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
            langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0",
        });
        prog.textContent = "recognizing text…";
        const { data } = await worker.recognize(currentFile);
        await worker.terminate();
        const text = (data && data.text ? data.text.trim() : "") || "(no text detected)";
        out.textContent = text;
        const conf = (data && data.confidence !== undefined) ? Math.round(data.confidence) : null;
        prog.textContent = "ocr complete" + (conf !== null ? " — confidence " + conf + "%" : "");
        $("stInfo").textContent = "ocr done";
    } catch (err) {
        prog.textContent = "✗ ocr failed: " + err.message;
        $("stInfo").textContent = "ocr: failed";
    }
    btn.disabled = false;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function sec(out, title, tag) {
    const s = document.createElement("div");
    s.className = "ii-sec";
    const h = document.createElement("div");
    h.className = "ii-sec-h";
    h.innerHTML = "<span>" + title + "</span>";
    if (tag) {
        const t = document.createElement("span");
        t.className = "tag";
        t.textContent = tag;
        h.appendChild(t);
    }
    const b = document.createElement("div");
    b.className = "ii-sec-b";
    s.appendChild(h); s.appendChild(b);
    out.appendChild(s); // ← was missing: sections were built but never attached
    return b;
}

function row(body, k, v, cls) {
    const r = document.createElement("div");
    r.className = "ii-row";
    const kEl = document.createElement("span");
    kEl.className = "ii-k";
    kEl.textContent = k;
    const vEl = document.createElement("span");
    vEl.className = "ii-v" + (cls ? " " + cls : "");
    vEl.textContent = v;
    r.appendChild(kEl); r.appendChild(vEl);
    body.appendChild(r);
}

function line(body, text, cls) {
    const d = document.createElement("div");
    d.className = "code-line" + (cls ? " " + cls : "");
    d.textContent = text;
    body.appendChild(d);
}

function renderReport(r) {
    const out = $("iiOut");
    out.textContent = "";

    /* FILE */
    const f = sec(out, "FILE", r.format + " · " + fmtBytes(r.size));
    row(f, "DETECTED", r.format + (r.detail ? " — " + r.detail : ""));
    row(f, "CLAIMED EXT", r.claimed || "—");
    if (r.mismatch) row(f, "VERDICT", "⚠ '" + r.claimed + "' is not a real " + r.format + " file", "bad");
    row(f, "DIMENSIONS", r.w + " × " + r.h + " px");
    if (r.extra) for (const k of Object.keys(r.extra)) row(f, k.toUpperCase(), r.extra[k]);
    row(f, "SHA-256", r.sha || "— (needs https:// or localhost)", r.sha ? "ok" : "");
    if (!r.sha) row(f, "HASH NOTE", "open via localhost/https to enable hashing", "warn");

    /* METADATA */
    if (r.exifRows && r.exifRows.length) {
        const m = sec(out, "METADATA", "exif · parsed locally");
        for (const [k, v] of r.exifRows) row(m, k, v);
    } else {
        const m = sec(out, "METADATA", "exif");
        line(m, "(no camera metadata found in this file)", "none");
    }

    /* GPS */
    if (r.gps) {
        const g = sec(out, "GPS", "geotag");
        row(g, "LATITUDE", r.gps.latDms + "  (" + r.gps.lat.toFixed(6) + ")");
        row(g, "LONGITUDE", r.gps.lonDms + "  (" + r.gps.lon.toFixed(6) + ")");
        if (r.gps.alt) row(g, "ALTITUDE", r.gps.alt);
        if (r.gps.when) row(g, "WHEN", r.gps.when);
        const linkRow = document.createElement("div");
        linkRow.className = "ii-row";
        const a = document.createElement("a");
        a.className = "ii-gps-link";
        a.href = r.gps.link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "open in OpenStreetMap ↗";
        linkRow.appendChild(a);
        g.appendChild(linkRow);
    }

    /* CODES */
    const c = sec(out, "CODES", r.codesUsed || "qr / barcode");
    if (r.codes && r.codes.length) {
        for (const code of r.codes) {
            const d = document.createElement("div");
            d.className = "code-line";
            const t = document.createElement("span");
            t.className = "ctype";
            t.textContent = code.type;
            d.appendChild(t);
            d.appendChild(document.createTextNode(code.value));
            c.appendChild(d);
        }
    } else {
        line(c, "(no QR / barcode detected)", "none");
    }

    /* OCR */
    const o = sec(out, "OCR", "tesseract.js · eng");
    const prog = document.createElement("div");
    prog.className = "ocr-prog";
    prog.id = "ocrProg";
    prog.textContent = "not run yet — press ⬡ RUN OCR";
    const pre = document.createElement("div");
    pre.className = "ocr-out";
    pre.id = "ocrOut";
    pre.textContent = "";
    o.appendChild(prog); o.appendChild(pre);

    /* PALETTE */
    if (r.palette && r.palette.length) {
        const p = sec(out, "PALETTE", "dominant colors");
        const sw = document.createElement("div");
        sw.className = "swatches";
        for (const col of r.palette) {
            const s = document.createElement("div");
            s.className = "sw";
            const chip = document.createElement("div");
            chip.className = "sw-chip";
            chip.style.background = col.hex;
            const label = document.createElement("div");
            label.textContent = col.hex + " " + col.pct + "%";
            s.appendChild(chip); s.appendChild(label);
            sw.appendChild(s);
        }
        p.appendChild(sw);
    }
}

function resetView() {
    $("iiOut").textContent = "";
    $("iiOut").appendChild($("iiPlaceholder"));
    $("iiPlaceholder").hidden = false;
    $("iiFileCard").classList.add("hidden");
    $("btnOcr").disabled = true;
    $("btnNew").disabled = true;
    $("stFile").textContent = "NO_IMAGE";
    $("stInfo").textContent = "awaiting input";
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    currentFile = null;
    lastReport = null;
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

let currentFile = null, currentUrl = null, lastReport = null;

async function analyze(file) {
    if (!file || !file.type || !file.type.startsWith("image/")) {
        $("stInfo").textContent = "✗ not an image file";
        return;
    }
    currentFile = file;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(file);
    $("stFile").textContent = file.name.toUpperCase();
    $("stInfo").textContent = "reading bytes…";

    const buf = await file.arrayBuffer();
    const sniffed = sniffFormat(buf);

    $("fcName").textContent = file.name;
    $("fcSize").textContent = fmtBytes(file.size);
    $("fcThumb").src = currentUrl;
    $("fcThumb").hidden = false;
    $("iiFileCard").classList.remove("hidden");
    $("btnOcr").disabled = false;
    $("btnNew").disabled = false;

    const report = {
        size: file.size,
        claimed: file.name.split(".").pop().toLowerCase() || "—",
        format: sniffed ? sniffed.fmt : "UNKNOWN",
        detail: null,
        sha: await sha256(buf),
        codes: [],
    };

    if (!sniffed) {
        $("stInfo").textContent = "✗ unknown file type";
        report.w = report.h = 0;
        renderReport(report);
        return;
    }
    report.detail = sniffed.mime;
    const claimed = report.claimed;
    report.mismatch = claimed !== sniffed.ext && !(sniffed.fmt === "JPEG" && (claimed === "jpeg" || claimed === "jpe")) &&
        !(sniffed.fmt === "TIFF" && claimed === "tif");

    const dims = parseDims(buf, sniffed.fmt);
    report.extra = dims ? dims.extra : null;

    const exif = parseExif(buf);
    report.exifRows = fmtExif(exif);
    report.gps = fmtGps(exif ? exif.gps : null);

    // load the actual image for palette / codes / dims fallback
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error("decode failed"));
            im.src = currentUrl;
        });
        report.w = dims ? dims.w : img.naturalWidth;
        report.h = dims ? dims.h : img.naturalHeight;
        $("fcDims").textContent = report.w + " × " + report.h;
        report.palette = extractPalette(img);
        $("stInfo").textContent = "scanning for codes…";
        report.codes = await detectCodes(img);
        report.codesUsed = (window.BarcodeDetector ? "barcode detector + jsQR" : "jsQR (CDN)");
    } catch (e) {
        report.w = dims ? dims.w : 0;
        report.h = dims ? dims.h : 0;
        $("fcDims").textContent = report.w + " × " + report.h;
        report.palette = [];
        report.codesUsed = "—";
    }

    lastReport = report;
    renderReport(report);
    $("stInfo").textContent = "analyzed: " + report.format + " " + report.w + "×" + report.h +
        (report.codes.length ? " · " + report.codes.length + " code(s) found" : "");
}

/* ------------------------------------------------------------------ */
/* Sample image — a prescription slip drawn on canvas (no assets)      */
/* ------------------------------------------------------------------ */

function makeSampleFile(cb) {
    const c = document.createElement("canvas");
    c.width = 620; c.height = 340;
    const x = c.getContext("2d");

    // paper slip
    x.fillStyle = "#eef6ee";
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = "#9db89d";
    x.lineWidth = 2;
    x.strokeRect(1, 1, c.width - 2, c.height - 2);

    // clinic header band
    x.fillStyle = "#0a3d1a";
    x.fillRect(14, 14, c.width - 28, 40);
    x.fillStyle = "#e8ffe8";
    x.font = "bold 18px monospace";
    x.fillText("MEDTERM RURAL CLINIC — RX SLIP", 28, 40);
    x.font = "12px monospace";
    x.fillStyle = "#c9e8c9";
    x.fillText("dispensing pharmacy · 2026-09-04", 28, 58);

    // patient line
    x.fillStyle = "#0a3d1a";
    x.font = "13px monospace";
    x.fillText("PATIENT: OKONKWO C.   AGE: 41   WEIGHT: ~65 kg", 28, 92);

    // dashed rule
    x.setLineDash([6, 4]);
    x.beginPath(); x.moveTo(14, 104); x.lineTo(c.width - 14, 104); x.stroke();
    x.setLineDash([]);

    // the prescription
    x.font = "bold 15px monospace";
    x.fillText("1) ACETAMINOPHEN 500 mg", 28, 132);
    x.font = "13px monospace";
    x.fillText("   take 1 tablet every 6 hours as needed", 28, 152);
    x.fillText("   for fever or headache", 28, 168);

    x.font = "bold 15px monospace";
    x.fillText("2) ORS SACHET", 28, 196);
    x.font = "13px monospace";
    x.fillText("   dissolve 1 sachet in 1 L clean water", 28, 216);
    x.fillText("   sip after each loose stool", 28, 232);

    // footer
    x.font = "bold 12px monospace";
    x.fillText("REVIEW IN 3 DAYS IF NO IMPROVEMENT", 28, 272);
    x.font = "11px monospace";
    x.fillStyle = "#4a6a4a";
    x.fillText("generic names only — confirm dosing with the clinician", 28, 292);

    // a decorative green cross
    x.fillStyle = "#0a3d1a";
    x.fillRect(c.width - 84, 250, 20, 60);
    x.fillRect(c.width - 114, 280, 80, 20);

    c.toBlob((blob) => cb(new File([blob], "sample_rx.png", { type: "image/png" })));
}

/* ------------------------------------------------------------------ */
/* Report copy                                                         */
/* ------------------------------------------------------------------ */

async function copyReport() {
    if (!lastReport) { $("stInfo").textContent = "nothing to copy yet"; return; }
    const r = lastReport;
    const L = [];
    L.push("IMGINTEL REPORT — " + r.format + " " + r.w + "×" + r.h + " · " + fmtBytes(r.size));
    L.push("file: " + $("fcName").textContent);
    L.push("detected format: " + r.format + (r.detail ? " (" + r.detail + ")" : "") + (r.mismatch ? "  ⚠ claimed ext does not match!" : ""));
    L.push("dimensions: " + r.w + " × " + r.h);
    if (r.extra) for (const k of Object.keys(r.extra)) L.push(k + ": " + r.extra[k]);
    if (r.sha) L.push("sha-256: " + r.sha);
    L.push("");
    L.push("— metadata —");
    if (r.exifRows && r.exifRows.length) r.exifRows.forEach(([k, v]) => L.push(k + ": " + v));
    else L.push("(none)");
    if (r.gps) {
        L.push("");
        L.push("— gps —");
        L.push("lat: " + r.gps.latDms + " (" + r.gps.lat.toFixed(6) + ")");
        L.push("lon: " + r.gps.lonDms + " (" + r.gps.lon.toFixed(6) + ")");
        if (r.gps.alt) L.push("alt: " + r.gps.alt);
        if (r.gps.when) L.push("when: " + r.gps.when);
    }
    L.push("");
    L.push("— codes —");
    if (r.codes && r.codes.length) r.codes.forEach((c) => L.push("[" + c.type + "] " + c.value));
    else L.push("(none)");
    L.push("");
    L.push("— palette —");
    if (r.palette && r.palette.length) r.palette.forEach((c) => L.push(c.hex + "  " + c.pct + "%"));
    try {
        await navigator.clipboard.writeText(L.join("\n"));
        $("stInfo").textContent = "report copied to clipboard";
    } catch (e) {
        $("stInfo").textContent = "✗ clipboard blocked";
    }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

const dz = $("dropZone");

dz.addEventListener("click", () => $("fileInput").click());
dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); }
});
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) analyze(f);
});

window.addEventListener("paste", (e) => {
    const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (f && f.type.startsWith("image/")) analyze(f);
});

$("fileInput").addEventListener("change", () => {
    const f = $("fileInput").files[0];
    if (f) analyze(f);
    $("fileInput").value = "";
});

$("btnBrowse").addEventListener("click", () => $("fileInput").click());
$("btnSample").addEventListener("click", () => {
    makeSampleFile((file) => {
        analyze(file);
        $("stInfo").textContent = "sample loaded — analyzing…";
    });
});
$("btnNew").addEventListener("click", resetView);
$("btnOcr").addEventListener("click", runOcr);
$("btnCopy").addEventListener("click", copyReport);

/* clock */
setInterval(() => {
    const d = new Date();
    $("stClock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}, 1000);

/* banner */
const banner = [
    "  ▄▄▄▄▄▄  ▄▄▄▄▄▄  ▄▄▄▄▄▄  ▄▄  ▄▄▄▄▄▄  ▄▄▄▄▄▄  ▄▄▄▄▄▄  ▄▄▄▄▄▄",
    "  █      █      █      █  █  █      █      █      █      █",
    "  █▄▄▄▄▄  █▄▄▄▄  █  █▄▄  █  █▄▄▄▄  █▄▄▄▄▄  █▄▄▄▄▄  █▄▄▄▄▄",
    "      █  █      █  █  █  █  █      █      █      █      █",
    "  ▄▄▄▄▄  █▄▄▄▄▄▄  █▄▄▄▄▄▄  █▄▄  █▄▄▄▄▄▄  █▄▄▄▄▄▄  █▄▄▄▄▄▄",
].join("\n");
$("iiBanner").textContent = banner;

/* test hook — exposes the pure parsers for automated checks */
if (typeof window !== "undefined") {
    window.__ii = { sniffFormat, parseDims, parseExif, fmtExif, fmtGps, fmtBytes };
}

})();