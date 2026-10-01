/* ============================================================
   QRTERM — Encode & Decode QR codes
   Generation via qrcode (CDN), decoding via jsQR (CDN) +
   camera / image files. Both libraries lazy-load on first use,
   exactly like pixelforge's Three.js.
   ============================================================ */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }

/* ------------------------------------------------------------------ */
/* Lazy CDN loading (jsDelivr, like the rest of the family)            */
/* ------------------------------------------------------------------ */

const QRCODE_CDN = "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js";
const JSQR_CDN = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

let qrPromise = null, jsqrPromise = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Could not load " + src + " from CDN — this tool needs internet for its first use."));
        document.head.appendChild(s);
    });
}

function loadQr() {
    if (!qrPromise) qrPromise = loadScript(QRCODE_CDN);
    return qrPromise;
}

function loadJsqr() {
    if (!jsqrPromise) jsqrPromise = loadScript(JSQR_CDN);
    return jsqrPromise;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function showTab(which) {
    const gen = which === "gen";
    $("panelGen").classList.toggle("hidden", !gen);
    $("panelDec").classList.toggle("hidden", gen);
    $("btnTabGen").classList.toggle("active", gen);
    $("btnTabDec").classList.toggle("active", !gen);
    $("stMode").textContent = gen ? "ENCODE" : "DECODE";
    if (gen) $("stInfo").textContent = "qr code forge · 100% client-side";
    else $("stInfo").textContent = "jsQR decoder · camera or image file";
}

/* ------------------------------------------------------------------ */
/* WiFi / email / sms / tel payload builders                           */
/* ------------------------------------------------------------------ */

function buildPayload() {
    const type = $("genType").value;
    const data = $("genData").value.trim();
    if (type === "wifi") {
        const ssid = $("wifiSsid").value.trim();
        const key = $("wifiKey").value;
        const sec = $("wifiSec").value;
        if (!ssid) throw new Error("enter a network SSID first");
        const esc = (s) => s.replace(/([\\;,:"])/g, "\\$1");
        if (sec === "nopass") return `WIFI:T:nopass;S:${esc(ssid)};;`;
        return `WIFI:T:${sec};S:${esc(ssid)};P:${esc(key)};;`;
    }
    if (type === "email") {
        const m = data.match(/^([^@\s]+@[^@\s]+)(?:\s+(.+))?$/);
        if (!m) throw new Error("email format: address [subject]");
        return `mailto:${m[1]}?subject=${encodeURIComponent(m[2] || "")}`;
    }
    if (type === "tel") {
        if (!/^\+?[\d\s()-]+$/.test(data)) throw new Error("phone format: +1234567890");
        return "tel:" + data.replace(/\s+/g, "");
    }
    if (type === "sms") {
        const m = data.match(/^(\+?[\d\s()-]+)(?:\s+(.+))?$/);
        if (!m) throw new Error("sms format: number [message]");
        return `SMSTO:${m[1].replace(/\s+/g, "")}:${m[2] || ""}`;
    }
    if (type === "url") {
        if (!/^https?:\/\//i.test(data) && data !== "") return "https://" + data;
        return data;
    }
    if (!data) throw new Error("DATA field is empty — type something first");
    return data;
}

/* ------------------------------------------------------------------ */
/* Encode                                                              */
/* ------------------------------------------------------------------ */

async function generate() {
    const canvas = $("qrCanvas");
    const placeholder = $("qrPlaceholder");
    let payload;
    try {
        payload = buildPayload();
    } catch (err) {
        $("qrOutMeta").textContent = "✗ " + err.message;
        return;
    }
    if (!payload) {
        $("qrOutMeta").textContent = "✗ nothing to encode";
        return;
    }

    $("stInfo").textContent = "loading qrcode engine (first use pulls from CDN)...";
    try {
        await loadQr();
    } catch (err) {
        $("qrOutMeta").textContent = "✗ " + err.message;
        $("stInfo").textContent = "encode: CDN unavailable";
        return;
    }

    const size = parseInt($("genSize").value, 10) || 512;
    const margin = $("genMargin").checked ? 4 : 0;
    try {
        await QRCode.toCanvas(canvas, payload, {
            width: size,
            margin,
            errorCorrectionLevel: "M",
            color: { dark: "#000000", light: "#ffffff" },
        });
    } catch (err) {
        $("qrOutMeta").textContent = "✗ could not encode: " + err.message;
        return;
    }

    placeholder.classList.add("hidden");
    canvas.classList.remove("hidden");
    const n = payload.length;
    $("qrOutMeta").textContent = `✓ ${n} chars · ${size}px · payload type: ${$("genType").value.toUpperCase()}`;
    $("stInfo").textContent = "qr forged";
}

/* ------------------------------------------------------------------ */
/* Decode                                                              */
/* ------------------------------------------------------------------ */

function renderDecoded(text, meta) {
    const out = $("decOut");
    out.textContent = "";
    if (!text) {
        const span = document.createElement("span");
        span.className = "faint";
        span.textContent = "[ DECODED PAYLOAD // NONE ]";
        out.appendChild(span);
        $("decMeta").textContent = "—";
        return;
    }
    const pre = document.createElement("div");
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = text;
    out.appendChild(pre);
    $("decMeta").textContent = meta || "decoded";
}

function decodeImageFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        decodeCanvasFrom(img);
    };
    img.onerror = () => { URL.revokeObjectURL(url); renderDecoded(null, "✗ could not read image"); };
    img.src = url;
}

function decodeCanvasFrom(img) {
    const maxW = 1024;
    const scale = Math.min(1, maxW / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    decodeFromImageData(data, `${img.width}×${img.height} source`);
}

function decodeFromImageData(imageData, meta) {
    $("stInfo").textContent = "running jsQR...";
    loadJsqr()
        .then(() => {
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
            if (code && code.data) {
                renderDecoded(code.data, `${code.data.length} chars · ${meta}`);
                $("stInfo").textContent = "qr decoded";
            } else {
                renderDecoded(null, "no QR found in " + meta);
                $("stInfo").textContent = "decode: no QR found";
            }
        })
        .catch((err) => {
            renderDecoded(null, "✗ " + err.message);
            $("stInfo").textContent = "decode: CDN unavailable";
        });
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

let camStream = null, camTimer = null, camActive = false;

async function toggleCam() {
    const video = $("camVideo");
    const wrap = $("camWrap");
    const scan = $("camScan");

    if (camActive) {
        camActive = false;
        if (camTimer) { clearInterval(camTimer); camTimer = null; }
        if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
        video.srcObject = null;
        wrap.classList.add("hidden");
        $("btnCam").textContent = "🎥 CAMERA";
        $("stInfo").textContent = "camera off";
        return;
    }

    $("stInfo").textContent = "requesting camera access...";
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (err) {
        renderDecoded(null, "✗ camera denied or unavailable: " + err.message);
        $("stInfo").textContent = "decode: camera blocked";
        return;
    }
    try { await loadJsqr(); } catch (err) {
        renderDecoded(null, "✗ " + err.message);
        $("stInfo").textContent = "decode: CDN unavailable";
        camStream.getTracks().forEach((t) => t.stop());
        camStream = null;
        return;
    }

    video.srcObject = camStream;
    await video.play().catch(() => {});
    wrap.classList.remove("hidden");
    camActive = true;
    $("btnCam").textContent = "⏹ STOP CAM";
    $("stInfo").textContent = "scanning — point at a QR code";

    // continuous scan ~8 fps
    const scanOnce = () => {
        if (!camActive || video.readyState < 2) return;
        scan.width = video.videoWidth;
        scan.height = video.videoHeight;
        const ctx = scan.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, scan.width, scan.height);
        const data = ctx.getImageData(0, 0, scan.width, scan.height);
        const code = jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" });
        if (code && code.data) {
            renderDecoded(code.data, `${code.data.length} chars · live camera`);
            $("stInfo").textContent = "qr locked ✓";
            // brief pause so the user can read it, then keep scanning
            clearInterval(camTimer);
            camTimer = setTimeout(() => {
                if (camActive) camTimer = setInterval(scanOnce, 120);
            }, 2500);
        }
    };
    camTimer = setInterval(scanOnce, 120);
}

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */

$("btnTabGen").addEventListener("click", () => showTab("gen"));
$("btnTabDec").addEventListener("click", () => showTab("dec"));
showTab("gen");

$("genType").addEventListener("change", () => {
    const wifi = $("genType").value === "wifi";
    $("wifiRow").classList.toggle("hidden", !wifi);
    $("genData").classList.toggle("hidden", wifi);
    if (wifi) $("stInfo").textContent = "wifi payload: SSID + security";
});

$("btnGen").addEventListener("click", generate);
$("genData").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
});
$("wifiSsid").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); generate(); }
});
$("wifiKey").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); generate(); }
});

$("btnDl").addEventListener("click", () => {
    const canvas = $("qrCanvas");
    if (canvas.classList.contains("hidden")) { $("qrOutMeta").textContent = "✗ generate a QR first"; return; }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "qrterm_" + Date.now() + ".png";
    a.click();
    $("qrOutMeta").textContent = "⤓ png saved";
});

$("btnImg").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", () => {
    const f = $("fileInput").files[0];
    if (f) decodeImageFile(f);
    $("fileInput").value = "";
});

$("btnCam").addEventListener("click", toggleCam);

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

setInterval(() => {
    const d = new Date();
    $("stClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

})();