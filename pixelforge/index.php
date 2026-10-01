<?php
/**
 * PixelForge — free AI image studio.
 * Standalone tool (unrelated to the Attan website) that generates images
 * through the free Perchance Stable Diffusion service. No API key needed.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PixelForge — Free AI Image Studio</title>
<meta name="description" content="PixelForge: free, unlimited AI image generation. No API key, no signup, no watermarks.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
</head>
<body>

<div class="bg-glow bg-glow-a"></div>
<div class="bg-glow bg-glow-b"></div>
<div class="bg-grid"></div>

<header class="topbar">
    <div class="brand">
        <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>
            </svg>
        </span>
        <span class="brand-name">PIXEL<span class="grad">FORGE</span></span>
        <span class="brand-tag">neural forge terminal</span>
    </div>
    <div class="top-right">
        <span id="statusPill" class="status-pill status-loading">
            <span class="dot"></span><span id="statusText">Checking service…</span>
        </span>
    </div>
</header>

<main class="wrap">

    <section class="hero">
        <h1>&gt; describe it. <span class="grad">forge it.</span></h1>
        <p class="hero-sub">// free &amp; unlimited AI image generation · powered by open Stable Diffusion · no key · no signup · no watermarks</p>
    </section>

    <section class="studio">
        <!-- ============ CONTROLS ============ -->
        <div class="panel controls">
            <div class="field keep">
                <label>Mode</label>
                <div id="modeSeg" class="segmented segmented-4">
                    <button type="button" data-mode="image" class="active">🖼 Images</button>
                    <button type="button" data-mode="video">🎬 Video</button>
                    <button type="button" data-mode="story">📖 Story</button>
                    <button type="button" data-mode="3d">🌀 3D</button>
                </div>
            </div>

            <div class="field" data-not-story>
                <div class="label-row">
                    <label for="prompt">Prompt <span class="req">*</span></label>
                    <button type="button" id="enhanceBtn" class="enhance-btn" title="Expand this prompt into a detailed, vivid version (free AI)" aria-label="Enhance prompt">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.5"/></svg>
                        <span>Enhance</span>
                    </button>
                </div>
                <div class="prompt-history-wrap" id="promptHistoryWrap">
                    <div class="textarea-wrap">
                        <textarea id="prompt" name="prompt" rows="4" maxlength="2000" spellcheck="false"
                            placeholder="A lone acacia tree at golden hour over Lake Victoria, birds in the distance…"></textarea>
                        <span id="promptCount" class="char-count">0 / 2000</span>
                    </div>
                    <div class="prompt-history-list hidden" id="promptHistoryList"></div>
                </div>
            </div>

            <div class="field">
                <label for="styleSelect">Style</label>
                <select id="styleSelect" name="style" aria-label="Art style"></select>
            </div>

            <!-- ============ REFERENCE IMAGE (repaint / img2img) ============ -->
            <details class="advanced" id="refPanel" data-img data-not-story>
                <summary>
                    <span class="adv-icon" aria-hidden="true">🖼</span>
                    <span class="adv-label">Reference image</span>
                    <span class="hint">repaint · img2img · optional</span>
                    <span class="adv-chevron" aria-hidden="true">▾</span>
                </summary>
                <div class="advanced-body">
                    <label id="refDrop" class="ref-drop" title="Upload a photo, then pick a Repaint style (instant local effect), Free img2img, or AI Repaint. No upload = normal text-to-image.">
                        <input type="file" id="refFile" accept="image/*" hidden>
                        <span class="ref-drop-icon" aria-hidden="true">🖼</span>
                        <span class="ref-drop-text" id="refDropText">Drop a photo here or <b>click to browse</b></span>
                    </label>
                    <div id="refPreviewWrap" class="ref-preview hidden">
                        <img id="refPreview" alt="Reference image preview">
                        <button type="button" id="refRemove" class="ref-remove" title="Remove reference image" aria-label="Remove reference image">✕</button>
                    </div>
                    <div id="refStyleRow" class="ref-strength hidden">
                        <label for="refStyle">Repaint style</label>
                        <select id="refStyle" aria-label="Repaint style">
                            <option value="oil">🎨 Oil Painting</option>
                            <option value="sketch">✏️ Pencil Sketch</option>
                            <option value="watercolor">🌊 Watercolor</option>
                            <option value="pop">👾 Pop Art</option>
                            <option value="pixel">🟦 Pixel Art</option>
                            <option value="mosaic">🔲 Mosaic</option>
                            <option value="vintage">🕰️ Vintage</option>
                            <option value="bw">⚫ Black &amp; White</option>
                            <option value="negative">🔁 Negative</option>
                            <option value="glow">💡 Glow</option>
                            <option value="free">🆓 Free img2img (keyless)</option>
                            <option value="ai">✨ AI Repaint (HuggingFace)</option>
                        </select>
                    </div>
                    <div id="refStrengthRow" class="ref-strength hidden">
                        <label for="refBlur"><span id="refBlurLabel">Blend strength</span> <span id="refBlurVal" class="hint">50</span></label>
                        <input type="range" id="refBlur" min="0" max="100" step="1" value="50" title="How strongly the repaint shows vs. the original photo. Lower = keep the original more.">
                    </div>
                    <div id="refAiRow" class="ref-strength hidden">
                        <label for="hfKey">HuggingFace token <span class="hint">free · hf_…</span></label>
                        <div class="seed-wrap" id="hfKeyInputRow">
                            <input type="password" id="hfKey" autocomplete="off" spellcheck="false" placeholder="hf_…" title="Free token from huggingface.co/settings/tokens — unlocks AI Repaint (real img2img).">
                            <button type="button" id="hfKeySave" class="btn btn-primary vkey-btn">Save</button>
                        </div>
                        <div class="seed-wrap hidden" id="hfKeyManage">
                            <span class="footnote hf-saved">Token saved ✓</span>
                            <button type="button" id="hfKeyClear" class="btn btn-ghost vkey-btn">🗑 Remove token</button>
                        </div>
                    </div>
                    <div id="refFullBodyRow" class="ref-strength hidden">
                        <label class="stack-label">Full body <span class="hint">headshot → portrait</span></label>
                        <label class="switch" title="Anchor the headshot on a tall 2:3 canvas so the AI paints the body below — describe the body in the prompt. Output is forced to Portrait.">
                            <input type="checkbox" id="refFullBody">
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>
            </details>

            <div class="field" data-img data-not-story>
                <label>Resolution</label>
                <div id="resSeg" class="segmented segmented-4">
                    <button type="button" data-res="square" class="active">Square</button>
                    <button type="button" data-res="portrait">Portrait</button>
                    <button type="button" data-res="landscape">Landscape</button>
                    <button type="button" data-res="custom">Custom</button>
                </div>
            </div>
            <div class="field custom-res hidden" id="customResRow" data-img data-not-story>
                <label>Custom size <span class="hint">256–768 px · 64px steps · free engine max ~768</span></label>
                <div class="custom-res-inputs">
                    <input type="number" id="resW" min="256" max="768" step="64" value="768" aria-label="Width in pixels" title="Width in pixels — the free engine snaps to the nearest supported size">
                    <span class="custom-res-x" aria-hidden="true">×</span>
                    <input type="number" id="resH" min="256" max="768" step="64" value="768" aria-label="Height in pixels" title="Height in pixels — the free engine snaps to the nearest supported size">
                </div>
            </div>
            <div class="field" data-img data-not-story>
                <label>How many images <span class="hint">batch forge</span></label>
                <div id="countSeg" class="segmented segmented-6">
                    <button type="button" data-count="1">1</button>
                    <button type="button" data-count="2">2</button>
                    <button type="button" data-count="4" class="active">4</button>
                    <button type="button" data-count="8">8</button>
                    <button type="button" data-count="16">16</button>
                    <button type="button" data-count="32">32</button>
                </div>
            </div>

            <details class="advanced" id="advancedPanel" data-img data-not-story>
                <summary>
                    <span class="adv-icon" aria-hidden="true">⚙</span>
                    <span class="adv-label">Advanced</span>
                    <span class="hint">negative · seed · guidance</span>
                    <span class="adv-chevron" aria-hidden="true">▾</span>
                </summary>
                <div class="advanced-body">
                    <div class="field">
                        <label for="negative">Negative prompt <span class="hint">what to avoid</span></label>
                        <div class="neg-presets" id="negPresets">
                            <button type="button" class="neg-chip" data-neg="blurry, low quality, watermark, text, deformed"> blurry / low quality</button>
                            <button type="button" class="neg-chip" data-neg="cartoon, anime, 3d render, painting"> no cartoon</button>
                            <button type="button" class="neg-chip" data-neg="extra fingers, fused fingers, bad anatomy, malformed hands"> bad hands</button>
                            <button type="button" class="neg-chip" data-neg="nsfw, nude, sexual, explicit"> safe only</button>
                            <button type="button" class="neg-chip" data-neg="text, watermark, signature, logo, username"> no text</button>
                        </div>
                        <input type="text" id="negative" name="negative" spellcheck="false"
                            placeholder="blurry, low quality, watermark, text">
                    </div>
                    <div class="field">
                        <label for="seed" class="stack-label">Seed<span class="hint">fixed = same result · press S for a random one</span></label>
                        <div class="seed-wrap">
                            <input type="number" id="seed" name="seed" value="-1" min="-1" step="1">
                            <button type="button" id="seedDice" class="icon-btn" title="Random seed (S)" aria-label="Random seed">🎲</button>
                        </div>
                    </div>
                    <div class="field">
                        <label for="guidance">Guidance scale <span id="guidanceVal" class="hint">7</span></label>
                        <input type="range" id="guidance" name="guidance" min="1" max="20" step="0.5" value="7">
                    </div>
                    <div class="field mature-toggle">
                        <label for="matureToggle">Mature content <span class="hint">18+ · reveal flagged images</span></label>
                        <div class="switch">
                            <input type="checkbox" id="matureToggle">
                            <span class="slider"></span>
                        </div>
                    </div>
                </div>
            </details>

            <div class="field" data-video>
                <label>Video engine</label>
                <div id="videoEngineSeg" class="segmented segmented-2">
                    <button type="button" data-ve="free" class="active" title="Keyless txt2video — no API key, best-effort quality">Free · no key</button>
                    <button type="button" data-ve="replicate" title="Replicate minimax/video-01 — needs an r8_ API key">Replicate · r8 key</button>
                </div>
            </div>

            <div class="field" data-video>
                <label for="videoKey">Replicate API key <span class="hint">only for the Replicate engine</span></label>
                <div class="seed-wrap">
                    <input type="password" id="videoKey" autocomplete="off" spellcheck="false" placeholder="r8_…" title="Free/paid key from replicate.com — only needed when the Replicate engine is selected.">
                    <button type="button" id="videoKeySave" class="btn btn-primary vkey-btn">Save</button>
                </div>
            </div>

            <div class="field" data-video>
                <label for="polliKey">Pollinations key <span class="hint">free · no card · makes the free engine reliable</span></label>
                <div class="seed-wrap">
                    <input type="password" id="polliKey" autocomplete="off" spellcheck="false" placeholder="pk_… or sk_…" title="Free key from enter.pollinations.ai (no credit card) — the free engine prefers it, and falls back to a keyless service when absent.">
                    <button type="button" id="polliKeySave" class="btn btn-primary vkey-btn">Save</button>
                </div>
            </div>

            <!-- ============ STORY MODE ============ -->
            <div class="field" data-story>
                <label for="storyText">Your story <span class="req">*</span></label>
                <textarea id="storyText" rows="6" spellcheck="true" maxlength="8000"
                    placeholder="Paste a story, article, or speech… PixelForge splits it into scenes, forges an image for each, narrates it with a free AI voice, and renders a slideshow video."
                    title="Split into scenes, each gets an image + narration — then render one video."></textarea>
            </div>

            <div class="field" data-story>
                <label for="storyVoice">Narrator voice</label>
                <select id="storyVoice" title="Free Microsoft Edge neural voices — no key needed."></select>
            </div>

            <div class="field" data-story>
                <label for="storyRate">Speaking speed</label>
                <select id="storyRate">
                    <option value="-25%">Slow</option>
                    <option value="+0%" selected>Normal</option>
                    <option value="+25%">Fast</option>
                </select>
            </div>

            <div class="field" data-story>
                <label>Video format</label>
                <div id="aspectSeg" class="segmented segmented-3">
                    <button type="button" data-aspect="9:16" class="active">9:16 Short</button>
                    <button type="button" data-aspect="1:1">1:1</button>
                    <button type="button" data-aspect="16:9">16:9</button>
                </div>
            </div>

            <div class="field" data-story>
                <label for="splitRule">Scene splitting</label>
                <select id="splitRule">
                    <option value="paragraph" selected>By paragraph</option>
                    <option value="sentence">By sentence</option>
                    <option value="chars">By character count</option>
                </select>
            </div>

            <div class="field" data-story>
                <label class="stack-label">Captions <span class="hint">show text on video</span></label>
                <label class="switch switch-sm">
                    <input type="checkbox" id="storyCaptions" checked>
                    <span class="slider"></span>
                </label>
            </div>

            <!-- ============ 3D MODE (photo → 3D depth animation) ============ -->
            <div class="field" data-3d>
                <label class="stack-label">Photo <span class="hint">turn it into a 3D scene</span></label>
                <label id="d3dDrop" class="ref-drop" title="PixelForge builds a depth map from your photo and renders a live 3D parallax scene — move your mouse over the preview to look around. Free, keyless, all in your browser.">
                    <input type="file" id="d3dFile" accept="image/*" hidden>
                    <span class="ref-drop-icon" aria-hidden="true">🧊</span>
                    <span class="ref-drop-text">Drop a photo here or <b>click to browse</b></span>
                </label>
                <div id="d3dPreviewWrap" class="ref-preview hidden">
                    <img id="d3dPreview" alt="3D photo preview">
                    <button type="button" id="d3dRemove" class="ref-remove" title="Remove photo" aria-label="Remove photo">✕</button>
                </div>
            </div>

            <div class="field" data-3d>
                <label for="d3dDepthMode">Depth map</label>
                <select id="d3dDepthMode" aria-label="Depth map mode">
                    <option value="auto" selected>✨ Auto (smart)</option>
                    <option value="luminance">🔆 Luminance (bright = near)</option>
                    <option value="radial">🎯 Radial (center near)</option>
                    <option value="vertical">⛰ Vertical (bottom near)</option>
                    <option value="flat">⬚ Flat (no depth)</option>
                </select>
            </div>

            <div class="field" data-3d>
                <label for="d3dStrength">Depth strength <span id="d3dStrengthVal" class="hint">45</span></label>
                <input type="range" id="d3dStrength" min="0" max="100" step="1" value="45">
            </div>

            <div class="field" data-3d>
                <label for="d3dSmooth">Smoothness <span id="d3dSmoothVal" class="hint">60</span></label>
                <input type="range" id="d3dSmooth" min="0" max="100" step="1" value="60" title="Blurs the depth map so surfaces melt together instead of looking noisy.">
            </div>

            <div class="field" data-3d>
                <label for="d3dMotion">Animation</label>
                <select id="d3dMotion" aria-label="Animation style">
                    <option value="drift" selected>🌊 Drift (idle sway)</option>
                    <option value="kenburns">🎞 Ken Burns (slow zoom)</option>
                    <option value="waves">〰 Waves (ripple)</option>
                    <option value="none">🖱 Mouse only</option>
                </select>
            </div>

            <div class="field" data-3d>
                <label for="d3dSpeed">Speed <span id="d3dSpeedVal" class="hint">50</span></label>
                <input type="range" id="d3dSpeed" min="0" max="100" step="1" value="50">
            </div>

            <div class="field" data-3d>
                <button type="button" id="d3dRenderBtn" class="gen-btn" title="Render an 8s looping WebM you can drop straight into any website — or export a self-contained HTML embed with the live 3D effect.">
                    <span class="gen-icon">🎬</span>
                    <span class="gen-label">Render WebM</span>
                </button>
                <div class="d3d-btn-row">
                    <button type="button" id="d3dEmbedBtn" class="btn btn-ghost">📄 Embed HTML</button>
                    <button type="button" id="d3dFrameBtn" class="btn btn-ghost">🖼 Frame PNG</button>
                </div>
            </div>

            <button type="button" id="genBtn" class="gen-btn">
                <span class="gen-icon">⚡</span>
                <span class="gen-label">Forge Images</span>
            </button>

            <button type="button" id="storyGenBtn" class="gen-btn gen-btn-story" data-story>
                <span class="gen-icon">📖</span>
                <span class="gen-label">Generate Scenes</span>
            </button>
            <button type="button" id="storyRenderBtn" class="gen-btn gen-btn-story alt" data-story disabled>
                <span class="gen-icon">🎬</span>
                <span class="gen-label">Render Video</span>
            </button>
        </div>

        <!-- ============ RESULT (batch grid) ============ -->
        <div class="panel result" id="resultPanel">
            <div id="resultEmpty" class="result-empty">
                <div class="empty-art" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                        <path d="m21 15-5-5L5 21"/><path d="m9 6-5 5"/>
                    </svg>
                </div>
                <h3>// output buffer empty</h3>
                <p>Write a prompt, pick a style, choose how many, and hit <b>Forge Images</b> to start transmitting.</p>
                <div class="prompt-chips" id="promptChips">
                    <span class="chips-label">✨ Try a sample prompt</span>
                    <div class="chips-row">
                        <button type="button" class="chip" data-prompt="A lone acacia tree at golden hour over Lake Victoria, birds in the distance">🌳 Lake Victoria at dusk</button>
                        <button type="button" class="chip" data-prompt="Aerial view of Soroti city at sunrise, mist over the lake, warm golden light">🌅 Soroti from above</button>
                        <button type="button" class="chip" data-prompt="Vibrant Ugandan market scene with fresh produce and colorful fabrics, warm sunlight">🧺 Ugandan market</button>
                        <button type="button" class="chip" data-prompt="Cinematic portrait of a fisherman on Lake Kyoga at sunset, dramatic sky">🎣 Lake Kyoga</button>
                    </div>
                </div>
            </div>
            <div class="result-top">
                <div id="resultStatus" class="result-status hidden">
                    <span class="spinner"></span><span id="loadStatusText">Contacting image service…</span>
                </div>
                <div id="resultToolbar" class="result-toolbar hidden">
                    <span id="dlAllInfo" class="toolbar-info"></span>
                    <button type="button" id="dlAllBtn" class="btn btn-ghost">⬇ Download all</button>
                </div>
            </div>
            <div id="batchProgress" class="batch-progress hidden">
                <div class="bp-track"><div class="bp-fill" id="bpFill"></div></div>
                <span class="bp-count" id="bpCount">0 / 4</span>
                <span class="bp-eta" id="bpEta">—</span>
            </div>
            <div id="resultGrid" class="result-grid hidden"></div>
            <div id="storyScenes" class="story-scenes hidden"></div>
            <div id="storyPreviewWrap" class="story-preview-wrap hidden">
                <video id="storyPreview" controls playsinline preload="metadata"></video>
                <div class="story-preview-actions">
                    <a id="storyPreviewDl" class="btn btn-primary" href="#" download>⬇ Download video</a>
                    <button type="button" id="storyPreviewRe" class="btn btn-ghost">↻ Re-render</button>
                </div>
            </div>
            <!-- 3D mode result stage: live WebGL preview + rendered video -->
            <div id="d3dStage" class="d3d-stage hidden">
                <div id="d3dEmpty" class="result-empty">
                    <div class="empty-art" aria-hidden="true">🧊</div>
                    <h3>Your photo, in 3D</h3>
                    <p>Drop a photo on the left to turn it into an animated 3D depth scene — then render it as a looping video or grab the embed code.</p>
                </div>
                <div id="d3dView" class="d3d-view hidden">
                    <div id="d3dCanvasWrap" class="d3d-canvas-wrap"></div>
                    <div id="d3dResult" class="d3d-result hidden">
                        <video id="d3dResultVideo" controls playsinline preload="metadata"></video>
                        <div class="d3d-result-actions">
                            <a id="d3dResultDl" class="btn btn-primary" href="#" download>⬇ Download video</a>
                            <button type="button" id="d3dResultBack" class="btn btn-ghost">↻ Back to preview</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- ============ HISTORY ============ -->            <section class="history" id="historySection">
        <div class="history-head">
            <h2>Recent creations</h2>
            <div class="history-tools">
                <div class="history-search">
                    <input type="text" id="historySearch" placeholder="Search prompts…" class="history-search-input" aria-label="Search history">
                </div>
                <span id="historyCount" class="count-pill">0 images</span>
                <button type="button" id="clearAllBtn" class="btn btn-danger clear-btn" disabled>🗑 Clear all</button>
            </div>
        </div>
        <div id="historyGrid" class="grid"></div>
        <div id="historyEmpty" class="history-empty hidden">
            <p>Nothing forged yet. Your saved images will collect here.</p>
        </div>
    </section>

    <footer class="foot">
        <p>PIXELFORGE v2.1 · neural image forge · uplink: free Perchance stable diffusion API</p>
    </footer>
</main>

<!-- ============ LIGHTBOX ============ -->
<div id="lightbox" class="lightbox hidden">
    <div class="lightbox-backdrop" data-close></div>
    <div class="lightbox-panel">
        <button type="button" class="lightbox-close" data-close aria-label="Close">✕</button>
        <button type="button" class="lb-nav lb-prev" id="lbPrev" aria-label="Previous">‹</button>
        <button type="button" class="lb-nav lb-next" id="lbNext" aria-label="Next">›</button>
        <div class="lb-stage">
            <img id="lbImg" alt="Generated image">
        </div>
        <video id="lbVideo" class="hidden" controls playsinline preload="metadata"></video>
        <div id="lbMature" class="lb-mature hidden">
            <span class="lb-mature-icon">⚠️</span>
            <p>This image may contain mature content (graphic violence or sexual themes).</p>
            <button type="button" id="lbReveal" class="btn btn-primary">I'm 18+ — reveal</button>
        </div>
        <div class="lightbox-body">
            <div class="meta-grid">
                <div class="meta-item"><span class="meta-label">Seed</span><span id="lbSeed" class="meta-value">—</span></div>
                <div class="meta-item"><span class="meta-label">Size</span><span id="lbSize" class="meta-value">—</span></div>
                <div class="meta-item"><span class="meta-label">Style</span><span id="lbStyle" class="meta-value">—</span></div>
                <div class="meta-item"><span class="meta-label">Model</span><span class="meta-value">Stable Diffusion</span></div>
            </div>
            <div class="meta-prompt" id="lbPrompt"></div>
            <div class="result-actions">
                <a id="lbDownload" class="btn btn-primary" href="#" download>⬇ Download</a>
                <button type="button" id="lbReuse" class="btn btn-ghost">🎲 Reuse seed</button>
                <button type="button" id="lbCopy" class="btn btn-ghost">📋 Copy prompt</button>
                <button type="button" id="lbDelete" class="btn btn-danger">🗑 Delete</button>
            </div>
            <div class="lb-count" id="lbCount"></div>
        </div>
    </div>
</div>

<!-- ============ MATURE CONTENT CONFIRM ============ -->
<div id="matureModal" class="mature-modal hidden">
    <div class="mature-backdrop" data-mclose></div>
    <div class="mature-card">
        <div class="mature-icon">⚠️</div>
        <h3>Mature content ahead</h3>
        <p>This image may contain themes not suitable for all audiences — such as graphic violence or sexual content. You must be <b>18 or older</b> to view it.</p>
        <div class="mature-actions">
            <button type="button" id="matureYes" class="btn btn-primary">I'm 18+, show it</button>
            <button type="button" id="matureNo" class="btn btn-ghost">Not now</button>
        </div>
        <label class="mature-remember">
            <input type="checkbox" id="matureRemember" checked> Remember for this session
        </label>
    </div>
</div>

<!-- ============ CONFIRM DIALOG (delete / clear all) ============ -->
<div id="confirmModal" class="confirm-modal hidden">
    <div class="confirm-backdrop" data-cclose></div>
    <div class="confirm-card">
        <div class="confirm-icon">🗑</div>
        <h3 id="confirmTitle">Are you sure?</h3>
        <p id="confirmMsg"></p>
        <div class="confirm-actions">
            <button type="button" id="confirmNo" class="btn btn-ghost">Cancel</button>
            <button type="button" id="confirmYes" class="btn confirm-yes">Delete</button>
        </div>
    </div>
</div>

<div id="toast" class="toast hidden"></div>

<script src="assets/app.js"></script>
</body>
</html>
