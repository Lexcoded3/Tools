<?php /* ============================================================
   MOCKUPGEN — Website Mockup Generator (PHP edition)
   Modes:
     01) URL_MODE  — server-side proxy fetches any site, renders it
                     inside MacBook / iPad / iPhone X / iPhone SE frames
     02) UPLOAD_MODE — upload your own screenshots, PHP GD composites
                     them into device frames → downloadable PNG
   ============================================================ */ ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MOCKUPGEN — Website Mockup Generator</title>
<meta name="description" content="MOCKUPGEN: paste a URL or upload screenshots and preview your website inside real device frames — MacBook, iPad, iPhone. PHP backend, hacker terminal UI.">
<link rel="stylesheet" href="assets/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖥️</text></svg>">
</head>
<body data-theme="green">

<div class="crt-bezel">
    <div class="crt-screen">

        <!-- title bar -->
        <div class="titlebar">
            <span class="tb-dots"><i></i><i></i><i></i></span>
            <span class="tb-title">root@mockgen: ~/devices — MOCKUPGEN v1.0</span>
            <span class="tb-actions">
                <button type="button" class="tab active" data-tab="url">▸ URL_MODE</button>
                <button type="button" class="tab" data-tab="upload">▸ UPLOAD_MODE</button>
            </span>
        </div>

        <!-- URL mode -->
        <div class="panel active" id="panel-url">
            <form class="searchbox-wrap" id="urlForm" autocomplete="off">
                <input type="text" id="urlInput" placeholder="eg: https://example.com" spellcheck="false">
                <button type="submit" id="urlBtn">▸ Preview</button>
            </form>
            <p class="hint">server-side proxy · bypasses CORS · relative assets resolved via &lt;base&gt; tag</p>

            <div class="devices" id="devices">
                <div class="device dev-desktop" data-dev="desktop">
                    <span class="dev-label"><i class="led"></i> DESKTOP 24"</span>
                    <div class="dev-frame">
                        <div class="dev-screen"><div class="ph">// AWAITING_URL</div><div class="viewport"><iframe data-frame loading="lazy"></iframe></div></div>
                    </div>
                    <div class="monitor-stand"></div>
                    <div class="monitor-base"></div>
                </div>

                <div class="device dev-macbook" data-dev="macbook">
                    <span class="dev-label"><i class="led"></i> MACBOOK PRO</span>
                    <div class="dev-frame">
                        <div class="dev-screen"><div class="ph">// AWAITING_URL</div><div class="viewport"><iframe data-frame loading="lazy"></iframe></div></div>
                    </div>
                    <div class="base"></div>
                </div>

                <div class="device dev-ipad" data-dev="ipad">
                    <span class="dev-label"><i class="led"></i> IPAD MINI</span>
                    <div class="dev-frame">
                        <div class="dev-screen"><div class="ph">// AWAITING_URL</div><div class="viewport"><iframe data-frame loading="lazy"></iframe></div></div>
                    </div>
                </div>

                <div class="device dev-iphonex" data-dev="iphone-x">
                    <span class="dev-label"><i class="led"></i> IPHONE X</span>
                    <div class="dev-frame">
                        <div class="dev-screen"><div class="ph">// AWAITING_URL</div><div class="viewport"><iframe data-frame loading="lazy"></iframe></div></div>
                    </div>
                </div>

                <div class="device dev-iphonese" data-dev="iphone-se">
                    <span class="dev-label"><i class="led"></i> IPHONE SE</span>
                    <div class="dev-frame">
                        <div class="dev-screen"><div class="ph">// AWAITING_URL</div><div class="viewport"><iframe data-frame loading="lazy"></iframe></div></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Upload mode -->
        <div class="panel" id="panel-upload">
            <div class="upload-wrap">
                <div class="dev-picker" id="devPicker">
                    <button type="button" class="dev-chip active" data-device="desktop">▸ DESKTOP 24"</button>
                    <button type="button" class="dev-chip" data-device="macbook">▸ MACBOOK PRO</button>
                    <button type="button" class="dev-chip" data-device="ipad">▸ IPAD MINI</button>
                    <button type="button" class="dev-chip" data-device="iphone-x">▸ IPHONE X</button>
                    <button type="button" class="dev-chip" data-device="iphone-se">▸ IPHONE SE</button>
                </div>

                <div class="dropzone" id="dropzone">
                    <p class="dz-title">DROP SCREENSHOT // CLICK TO BROWSE</p>
                    <p class="dz-sub">accepts <b>.png</b> <b>.jpg</b> <b>.webp</b> · composed with PHP GD · your image is processed locally</p>
                </div>
                <input type="file" id="fileInput" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden>

                <div class="mock-result" id="mockResult">
                    <img id="mockImg" alt="generated mockup">
                    <div class="mock-actions">
                        <button type="button" class="btn" id="btnDownload">⤓ Download PNG</button>
                        <button type="button" class="btn btn-ghost" id="btnNew">↻ New upload</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- status bar -->
        <div class="statusbar">
            <span id="stMode">MODE: URL</span>
            <span class="st-url" id="stUrl">URL: --</span>
            <span id="stDev">DEV: --</span>
            <span class="st-right" id="stClock">--:--:--</span>
        </div>
    </div>
</div>

<script src="assets/app.js"></script>
</body>
</html>
