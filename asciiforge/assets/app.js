/* ============================================================
   ASCII FORGE — Image → ASCII art converter
   100% client-side. Images never leave the browser.
   ============================================================ */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropPanel = $("dropPanel");
const resultPanel = $("resultPanel");
const controls = $("controls");
const artOut = $("artOut");
const metaLine = $("metaLine");

function pad(n) { return String(n).padStart(2, "0"); }

/* Ramps: index rises with luminance — dark pixels get sparse glyphs, bright
   pixels get dense ink, so art reads correctly on a dark CRT screen. */
const RAMPS = {
    classic: " .:-=+*#%@",
    blocks:  " ░▒▓█",
    shade:   " ▁▂▃▄▅▆▇█",
    braille: null, // handled separately
    binary:  " 1",
    hex:     " 0123456789abcdef",
};

const BRAILLE_BITS = {
    0: [0x01, 0x08],
    1: [0x02, 0x10],
    2: [0x04, 0x20],
    3: [0x40, 0x80],
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let img = null;          // ImageBitmap / HTMLImageElement
let fileName = "NO_IMAGE";
let drawn = false;       // whether we've forged once (for sample re-forge)

const SAMPLE_W = 420, SAMPLE_H = 210;

function makeSampleImage() {
    const c = document.createElement("canvas");
    c.width = SAMPLE_W; c.height = SAMPLE_H;
    const g = c.getContext("2d");
    // phosphor-ish scene: radial glow + rings + glyphs
    const grad = g.createLinearGradient(0, 0, SAMPLE_W, SAMPLE_H);
    grad.addColorStop(0, "#04140a");
    grad.addColorStop(1, "#02100a");
    g.fillStyle = grad;
    g.fillRect(0, 0, SAMPLE_W, SAMPLE_H);

    for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(SAMPLE_W * 0.32, SAMPLE_H * 0.5, 18 + i * 13, 0, Math.PI * 2);
        g.strokeStyle = `rgba(51,255,102,${0.75 - i * 0.13})`;
        g.lineWidth = 2;
        g.stroke();
    }
    g.fillStyle = "#33ff66";
    g.beginPath();
    g.arc(SAMPLE_W * 0.32, SAMPLE_H * 0.5, 9, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = "#33ff66";
    g.shadowBlur = 18;

    g.font = "700 64px 'Courier New', monospace";
    g.fillStyle = "#eaffef";
    g.fillText("ASCII", SAMPLE_W * 0.5, SAMPLE_H * 0.44);
    g.font = "700 40px 'Courier New', monospace";
    g.fillStyle = "#33ff66";
    g.fillText("> FORGE //", SAMPLE_W * 0.52, SAMPLE_H * 0.76);

    // star field
    for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(200,255,220,${0.15 + Math.random() * 0.6})`;
        g.fillRect(Math.random() * SAMPLE_W, Math.random() * SAMPLE_H, 2, 2);
    }
    return c;
}

/* ------------------------------------------------------------------ */
/* Forge pipeline                                                      */
/* ------------------------------------------------------------------ */

function loadFromCanvas(canvas, name) {
    const nimg = new Image();
    nimg.onload = () => { img = nimg; fileName = name; forge(); };
    nimg.src = canvas.toDataURL("image/png");
}

function loadFromFile(file) {
    const url = URL.createObjectURL(file);
    const nimg = new Image();
    nimg.onload = () => {
        URL.revokeObjectURL(url);
        img = nimg;
        fileName = file.name.toUpperCase();
        forge();
    };
    nimg.onerror = () => {
        URL.revokeObjectURL(url);
        bootMsg("[!] could not decode that image file", true);
    };
    nimg.src = url;
}

/* Font metrics for JetBrains Mono at the .art font-size (8px). */
const CHAR_W = 8 * 0.62;   // monospace advance ≈ 0.62em
const CHAR_H = 8 * 0.82;   // our art line-height

function forge() {
    if (!img) return;
    const rampName = $("ctlRamp").value;
    const sizeMul = parseFloat($("ctlSize").value);
    const invert = $("ctlInvert").checked;
    const color = $("ctlColor").checked;

    const isBraille = rampName === "braille";
    const sampleStep = isBraille ? 2 : 1; // braille samples a 2×4 px block per glyph

    const aspect = (img.height / img.width) * (CHAR_W / CHAR_H) * sampleStep;
    // Base column budget from the visible art area (cap keeps DOM light).
    const availW = Math.max(320, Math.min(1400, resultPanel.clientWidth || 900));
    let cols = Math.floor(availW / (CHAR_W * 2.6));
    cols = Math.max(16, Math.min(220, Math.round(cols * sizeMul)));
    let rows = Math.max(8, Math.round(cols * aspect));
    // Braille doubles vertical res: rows here are braille rows.
    if (isBraille) rows = Math.max(4, Math.round((cols / 2) * (img.height / img.width) * (CHAR_W / (CHAR_H * 2))));

    // Downscale buffer sized in *samples*.
    const bufW = cols * sampleStep;
    const bufH = rows * sampleStep * (isBraille ? 2 : 1);
    const canvas = document.createElement("canvas");
    canvas.width = bufW; canvas.height = bufH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, bufW, bufH);
    const data = ctx.getImageData(0, 0, bufW, bufH).data;

    const ramp = RAMPS[rampName] || RAMPS.classic;

    let outText = "";
    let outHtml = "";

    if (isBraille) {
        for (let r = 0; r < rows; r++) {
            let textRow = "", htmlRow = "";
            for (let c = 0; c < cols; c++) {
                let code = 0x2800, cr = 0, cg = 0, cb = 0, n = 0;
                for (let dr = 0; dr < 2; dr++) {
                    for (let dc = 0; dc < 4; dc++) {
                        const px = ((r * 4 + dc) * bufW + (c * 2 + dr)) * 4;
                        const rv = data[px], gv = data[px + 1], bv = data[px + 2];
                        const lum = (rv * 0.299 + gv * 0.587 + bv * 0.114);
                        cr += rv; cg += gv; cb += bv; n++;
                        // bright pixels light dots (invert flips it)
                        if (invert ? lum < 128 : lum >= 128) {
                            code |= BRAILLE_BITS[dc][dr];
                        }
                    }
                }
                const ch = String.fromCharCode(code);
                textRow += ch;
                if (color) {
                    const col = `rgb(${Math.round(cr / n)},${Math.round(cg / n)},${Math.round(cb / n)})`;
                    htmlRow += `<span style="color:${col}">${ch}</span>`;
                }
            }
            outText += textRow + "\n";
            outHtml += htmlRow + "\n";
        }
    } else {
        const rampLen = ramp.length;
        for (let r = 0; r < rows; r++) {
            let textRow = "", htmlRow = "";
            for (let c = 0; c < cols; c++) {
                const px = (r * bufW + c) * 4;
                const rv = data[px], gv = data[px + 1], bv = data[px + 2];
                let lum = rv * 0.299 + gv * 0.587 + bv * 0.114;
                if (invert) lum = 255 - lum;
                const idx = Math.min(rampLen - 1, Math.floor((lum / 255) * rampLen));
                const ch = ramp[idx];
                textRow += ch;
                if (color) {
                    const col = `rgb(${invert ? 255 - rv : rv},${invert ? 255 - gv : gv},${invert ? 255 - bv : bv})`;
                    htmlRow += `<span style="color:${col}">${ch}</span>`;
                }
            }
            outText += textRow + "\n";
            outHtml += htmlRow + "\n";
        }
    }

    outText = outText.replace(/\n$/, "");
    outHtml = outHtml.replace(/\n$/, "");

    if (color) {
        artOut.innerHTML = outHtml;
    } else {
        artOut.textContent = outText;
    }

    const glyphW = cols * sampleStep;
    const glyphH = rows * sampleStep * (isBraille ? 2 : 1);
    resultPanel.classList.remove("hidden");
    controls.classList.remove("hidden");
    metaLine.classList.remove("hidden");
    $("stFile").textContent = fileName;
    $("stInfo").textContent = `forged: ${glyphW} × ${glyphH}px → ${cols} × ${rows} glyphs · ${rampName}${invert ? " · inverted" : ""}${color ? " · color" : ""}`;
    metaLine.textContent = `image ${img.width}×${img.height} · ramp ${rampName} · ${color ? "color" : "mono"}`;
    drawn = true;
    dropPanel.classList.add("hidden");
}

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */

function bootMsg(text, isErr) {
    const el = document.createElement("div");
    el.className = "line " + (isErr ? "err" : "dim");
    el.textContent = text;
    artOut.textContent = "";
    metaLine.textContent = text;
}

function openFile() { fileInput.click(); }

fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (f) loadFromFile(f);
    fileInput.value = "";
});

dropPanel.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    openFile();
});

["dragenter", "dragover"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); dropPanel.classList.add("dragging"); })
);
["dragleave", "drop"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); dropPanel.classList.remove("dragging"); })
);
window.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) loadFromFile(f);
});

$("btnBrowse").addEventListener("click", (e) => { e.stopPropagation(); openFile(); });
$("btnSample").addEventListener("click", () => loadFromCanvas(makeSampleImage(), "sample_source.png"));
$("btnNew").addEventListener("click", () => {
    resultPanel.classList.add("hidden");
    controls.classList.add("hidden");
    metaLine.classList.add("hidden");
    dropPanel.classList.remove("hidden");
    img = null;
    $("stFile").textContent = "NO_IMAGE";
    $("stInfo").textContent = "awaiting source";
});

$("ctlRamp").addEventListener("change", forge);
$("ctlSize").addEventListener("change", forge);
$("ctlInvert").addEventListener("change", forge);
$("ctlColor").addEventListener("change", forge);
window.addEventListener("resize", () => { if (drawn) forge(); });

$("btnCopy").addEventListener("click", async () => {
    const text = artOut.innerText || "";
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        $("btnCopy").textContent = "✓ COPIED";
        setTimeout(() => { $("btnCopy").textContent = "⧉ COPY ART"; }, 1200);
    } catch {
        // fallback for non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch { /* noop */ }
        document.body.removeChild(ta);
        $("btnCopy").textContent = "✓ COPIED";
        setTimeout(() => { $("btnCopy").textContent = "⧉ COPY ART"; }, 1200);
    }
});

/* ------------------------------------------------------------------ */
/* Banner + clock + init                                               */
/* ------------------------------------------------------------------ */

const BANNER = [
    "         _   _",
    "        / \\ / \\",
    "       /   V   \\    ASCII  FORGE",
    "      /         \\   image → text",
    "     /  [####]   \\",
    "    /_____________\\",
].join("\n");

$("fpBanner").textContent = BANNER;

setInterval(() => {
    const d = new Date();
    $("stClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

window.addEventListener("DOMContentLoaded", () => {
    // banner already injected; focus nothing (panel click focuses)
});

})();
