/* ============================================================
   MOCKUPGEN — app.js
   ============================================================ */
(() => {
    "use strict";

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => [...document.querySelectorAll(sel)];

    const tabs = $$(".tab");
    const panels = { url: $("#panel-url"), upload: $("#panel-upload") };
    const devices = $$(".device");
    const urlForm = $("#urlForm");
    const urlInput = $("#urlInput");
    const urlBtn = $("#urlBtn");

    /* ---------------- tabs ---------------- */
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.toggle("active", t === tab));
            Object.entries(panels).forEach(([name, el]) => el.classList.toggle("active", name === tab.dataset.tab));
            $("#stMode").textContent = "MODE: " + tab.dataset.tab.toUpperCase();
        });
    });

    /* ---------------- URL mode ---------------- */
    function setDeviceState(dev, state) {
        const d = devices.find((el) => el.dataset.dev === dev);
        if (d) { d.classList.remove("loading", "ready", "error"); d.classList.add(state); }
    }

    function loadPreview(url) {
        const encoded = encodeURIComponent(url);
        const stamp = Date.now();
        devices.forEach((d) => {
            const frame = d.querySelector("iframe[data-frame]");
            const ph = d.querySelector(".ph");
            if (!frame) return;
            frame.src = "preview.php?url=" + encoded + "&t=" + stamp;
            if (ph) ph.style.display = "flex";
            setDeviceState(d.dataset.dev, "loading");
        });
        $("#stUrl").textContent = "URL: " + url;
    }

    // each iframe reports back when it loaded
    $$("iframe[data-frame]").forEach((frame) => {
        frame.addEventListener("load", () => {
            const dev = frame.closest(".device");
            if (dev) {
                const ph = dev.querySelector(".ph");
                if (ph) ph.style.display = "none";
                setDeviceState(dev.dataset.dev, "ready");
            }
        });
        frame.addEventListener("error", () => {
            const dev = frame.closest(".device");
            if (dev) setDeviceState(dev.dataset.dev, "error");
        });
    });

    urlForm.addEventListener("submit", (e) => {
        e.preventDefault();
        let url = urlInput.value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        urlInput.value = url;
        urlBtn.disabled = true;
        loadPreview(url);
        // allow re-click once previews land
        setTimeout(() => { urlBtn.disabled = false; }, 800);
    });

    // demo: press enter on empty input → nothing; keep simple.

    /* ---------------- Upload mode ---------------- */
    const devPicker = $("#devPicker");
    const dropzone = $("#dropzone");
    const fileInput = $("#fileInput");
    const mockResult = $("#mockResult");
    const mockImg = $("#mockImg");
    const btnDownload = $("#btnDownload");
    const btnNew = $("#btnNew");
    let currentDevice = "macbook";
    let currentFile = null;

    devPicker.addEventListener("click", (e) => {
        const chip = e.target.closest(".dev-chip");
        if (!chip) return;
        $$(".dev-chip").forEach((c) => c.classList.toggle("active", c === chip));
        currentDevice = chip.dataset.device;
        $("#stDev").textContent = "DEV: " + currentDevice.toUpperCase();
    });

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("drag");
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length) handleFile(fileInput.files[0]);
        fileInput.value = "";
    });

    async function handleFile(file) {
        if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
            dropzone.querySelector(".dz-sub").textContent = "✗ INVALID TYPE — png / jpg / webp only";
            return;
        }
        currentFile = file;
        dropzone.querySelector(".dz-title").textContent = "COMPOSING…";
        dropzone.querySelector(".dz-sub").textContent = file.name + " → " + currentDevice.toUpperCase();
        $("#stDev").textContent = "DEV: " + currentDevice.toUpperCase() + " // RENDER";

        const fd = new FormData();
        fd.append("device", currentDevice);
        fd.append("file", file);

        try {
            const res = await fetch("mockup.php", { method: "POST", body: fd });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "compose failed");
            mockImg.src = data.file;
            btnDownload.href = data.file;
            btnDownload.setAttribute("download", "mockup-" + currentDevice + ".png");
            mockResult.classList.add("show");
            dropzone.querySelector(".dz-title").textContent = "DROP SCREENSHOT // CLICK TO BROWSE";
            dropzone.querySelector(".dz-sub").textContent = "accepts .png .jpg .webp · composed with PHP GD · your image is processed locally";
            $("#stDev").textContent = "DEV: " + currentDevice.toUpperCase();
        } catch (err) {
            console.error(err);
            dropzone.querySelector(".dz-title").textContent = "✗ COMPOSE FAILED";
            dropzone.querySelector(".dz-sub").textContent = String(err.message || err);
            $("#stDev").textContent = "DEV: ERROR";
        }
    }

    btnNew.addEventListener("click", () => {
        mockResult.classList.remove("show");
        mockImg.removeAttribute("src");
        currentFile = null;
    });

    /* ---------------- clock ---------------- */
    function tick() {
        const d = new Date();
        $("#stClock").textContent =
            String(d.getHours()).padStart(2, "0") + ":" +
            String(d.getMinutes()).padStart(2, "0") + ":" +
            String(d.getSeconds()).padStart(2, "0");
    }
    tick();
    setInterval(tick, 1000);
})();
