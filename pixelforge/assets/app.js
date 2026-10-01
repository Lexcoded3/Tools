/* ============================================================
   PixelForge — app logic (batch studio)
   ============================================================ */
(function () {
  'use strict';

  /* Style presets (keys must match the backend STYLES map). */
  const STYLES = [
    ['none', 'No style'],
    ['photoreal', 'Photo'],
    ['anime', 'Anime'],
    ['oil', 'Oil Paint'],
    ['watercolor', 'Watercolor'],
    ['3d', '3D Render'],
    ['cyberpunk', 'Cyberpunk'],
    ['fantasy', 'Fantasy'],
    ['pixel', 'Pixel Art'],
    ['sketch', 'Sketch'],
    ['minimal', 'Minimal'],
    ['cartoon', 'Cartoon'],
  ];

  /* Local repaint presets (browser canvas effects) + the AI option. */
  const REPAINTS = {
    oil:       { label: 'Oil Painting' },
    sketch:    { label: 'Pencil Sketch' },
    watercolor:{ label: 'Watercolor' },
    pop:       { label: 'Pop Art' },
    pixel:     { label: 'Pixel Art' },
    mosaic:    { label: 'Mosaic' },
    vintage:   { label: 'Vintage' },
    bw:        { label: 'Black & White' },
    negative:  { label: 'Negative' },
    glow:      { label: 'Glow' },
    free:      { label: 'Free img2img' },
    ai:        { label: 'AI Repaint' },
  };

  const $ = (id) => document.getElementById(id);

  /* Auto-retry a failed generation up to this many total attempts. */
  const AUTO_RETRIES = 3;

  /* Simple request queue: prevents concurrent generation conflicts.
     Only one generation / video / repaint can run at a time. */
  const reqQueue = [];
  let reqRunning = false;

  function enqueueRequest(fn) {
    return new Promise((resolve, reject) => {
      reqQueue.push({ fn, resolve, reject });
      processQueue();
    });
  }

  async function processQueue() {
    if (reqRunning || reqQueue.length === 0) return;
    reqRunning = true;
    const { fn, resolve, reject } = reqQueue.shift();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    } finally {
      reqRunning = false;
      processQueue();
    }
  }

  /** Map common error messages to user-friendly explanations. */
  function friendlyError(err) {
    const msg = (err.message || String(err)).toLowerCase();
    if (/network|fetch|failed to fetch|networkerror/.test(msg)) {
      return 'Network error — check your internet connection and try again.';
    }
    if (/queue is busy|busy|throttl/.test(msg)) {
      return 'The free image service is under heavy load — wait a few seconds and try again.';
    }
    if (/timeout|timed out/.test(msg)) {
      return 'The request timed out — the service may be slow. Try again in a moment.';
    }
    if (/could not obtain.*key|token_required|failed_verification/.test(msg)) {
      return 'Could not get an API key — visit perchance.org once in your browser to clear the block, then retry.';
    }
    if (/verif|captcha|turnstile/.test(msg)) {
      return 'The service is asking for verification — open perchance.org in your browser first.';
    }
    if (/rate.?limit|too many|429/.test(msg)) {
      return 'Too many requests — slow down and try again in a minute.';
    }
    if (/invalid.*key|reject|401|403/.test(msg)) {
      return 'API key was rejected — double-check your key and try again.';
    }
    if (/cors|cross.?origin/.test(msg)) {
      return 'A cross-origin error occurred — try refreshing the page.';
    }
    return err.message || 'An unexpected error occurred — try again.';
  }

  const state = {
    style: 'none',
    resolution: 'square',
    count: 4,
    batch: [],      // current batch: array of {entry, url} | null
    history: [],    // latest history items
    busy: false,
    mode: 'image',      // 'image' | 'video' | 'story' | '3d'
    videoEngine: 'free', // 'free' (Pollinations key / keyless) | 'replicate' (r8 key)
    videoKey: false,    // a Replicate API key is saved
    polliKey: false,    // a free Pollinations key is saved (free video engine)
    hfKey: false,       // a HuggingFace token is saved (AI Repaint)
    ref: { url: '', blur: 0.5, style: 'oil', engine: 'local', fullBody: false },  // reference image: data URL + blend (0-1) + repaint style + engine (+ full-body composite flag for Edit mode)
    allowMature: localStorage.getItem('pf_mature') === '1',
    story: {
      scenes: [],             // [{ id, text, imageUrl, audioUrl, entry }]
      voice: 'en-US-ChristopherNeural',
      aspect: '9:16',
      captions: true,
    },
    storyBusy: false,
  };

  /* Story video canvas sizes (width x height). */
  const STORY_ASPECTS = {
    '9:16':  { w: 720, h: 1280 },
    '1:1':   { w: 720, h: 720 },
    '16:9':  { w: 1280, h: 720 },
  };

  /* Lightbox state */
  let lbItems = [];
  let lbIndex = 0;
  let lbZoomReset = null;   // assigned by bindLightboxZoom(); resets zoom/pan

  /* Batch progress timing (ms when the current batch started). */
  let batchT0 = 0;

  /* Mature-content confirm resolver */
  let matureResolver = null;

  /* Generic confirm-dialog resolver (delete / clear all) */
  let confirmResolver = null;

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, isErr = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('err', isErr);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 5200 : 3200);
  }

  /* ---------------- status ---------------- */
  let busyRecheckTimer = null;

  /* CSRF token: received from the status endpoint, attached to all POST requests. */
  let csrfToken = '';

  /** Build a FormData with the CSRF token included. */
  function csrfFormData() {
    const fd = new FormData();
    if (csrfToken) fd.append('csrf', csrfToken);
    return fd;
  }

  /** Merge CSRF token into an existing FormData. */
  function csrfAppend(fd) {
    if (csrfToken) fd.append('csrf', csrfToken);
    return fd;
  }

  /** Fetch the CSRF token (once) so the first POST is never rejected.
      checkStatus() normally provides it, but a fast first click can race it. */
  async function ensureCsrf() {
    if (csrfToken) return;
    try {
      const r = await fetch('api.php?action=status');
      const d = await r.json();
      if (d.ok && d.csrf) csrfToken = d.csrf;
    } catch (e) { /* offline — the POST will fail with a clear error anyway */ }
  }

  async function checkStatus() {
    const pill = $('statusPill');
    try {
      const r = await fetch('api.php?action=status');
      const d = await r.json();
      if (d.ok) {
        if (d.csrf) csrfToken = d.csrf;
        if (d.busy) {
          // Shared free engine under load — amber pill + keep polling.
          applyBusyPill();
          scheduleBusyRecheck();
        } else {
          pill.classList.remove('status-busy', 'status-loading', 'status-offline');
          pill.classList.add('status-online');
          const keyLabel = d.key === 'ready' ? 'online' : (d.key === 'manual' ? 'manual key' : 'unverified');
          $('statusText').textContent = 'Service online · ' + keyLabel + ' · ' + d.images + ' saved';
        }
      } else {
        throw new Error(d.error);
      }
    } catch (e) {
      pill.classList.remove('status-loading', 'status-online', 'status-busy');
      pill.classList.add('status-offline');
      $('statusText').textContent = 'Service offline';
      toast('Could not reach the image service. Check your internet connection.', true);
    }
  }

  /** Apply the amber under-load pill state (shared by the poll + instant hook). */
  function applyBusyPill() {
    const pill = $('statusPill');
    pill.classList.remove('status-online', 'status-loading', 'status-offline');
    pill.classList.add('status-busy');
    $('statusText').textContent = 'Service under load — generations may queue';
  }

  /** Flip the pill to "under load" the instant a busy-queue error arrives. */
  function markServiceBusy() {
    applyBusyPill();
    scheduleBusyRecheck();
  }

  /** While under load, re-check every 12s so the pill clears on its own. */
  function scheduleBusyRecheck() {
    if (busyRecheckTimer) return;
    busyRecheckTimer = setTimeout(() => {
      busyRecheckTimer = null;
      checkStatus();
    }, 12000);
  }

  /* ---------------- style select ---------------- */
  async function buildStyleSelect() {
    const sel = $('styleSelect');
    sel.innerHTML = '';
    // Pull the full list (tuned + Perchance templates) from the API; fall
    // back to the local presets if the service is unreachable.
    let items = null;
    try {
      const r = await fetch('api.php?action=styles');
      const d = await r.json();
      if (d.ok && d.items) items = d.items;
    } catch (e) { /* offline */ }
    if (!items) {
      items = {};
      STYLES.forEach(([key, label]) => { items[key] = label; });
    }
    Object.entries(items).forEach(([key, label]) => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = label;
      if (key === state.style) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      state.style = sel.value;
      saveSession();
    });
  }

  /* ---------------- guidance slider ---------------- */
  function bindSlider() {
    const s = $('guidance');
    const paint = () => {
      const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
      s.style.backgroundSize = pct + '% 100%';
      $('guidanceVal').textContent = s.value;
    };
    s.addEventListener('input', paint);
    s.addEventListener('input', saveSession);
    paint();
  }

  /* ---------------- segmented controls ---------------- */
  function bindSegmented(id, onPick) {
    $(id).addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-count], button[data-res], button[data-aspect], button[data-ve]');
      if (!btn) return;
      const key = btn.dataset.count || btn.dataset.res || btn.dataset.aspect || btn.dataset.ve;
      onPick(key, btn);
      $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  }

  /* ---------------- mature content gating ---------------- */
  function matureAuthorized() {
    if (state.allowMature) return true;
    // A recent confirmation reveals the current view even without "remember".
    if (state.revealNow && Date.now() < state.revealNow) return true;
    const until = Number(sessionStorage.getItem('pf_mature_session') || 0);
    return Date.now() < until;
  }

  function isGated(entry) {
    return !!(entry && entry.maybe_nsfw) && !matureAuthorized();
  }

  /** Ask for 18+ confirmation once; remembers for the session if checked. */
  function askMature() {
    // If a confirmation is already pending (shouldn't happen, but be safe),
    // chain onto it so no caller is left awaiting forever.
    if (matureResolver) {
      return new Promise((resolve) => {
        const prev = matureResolver;
        matureResolver = (ok) => { prev(ok); resolve(ok); };
      });
    }
    return new Promise((resolve) => {
      matureResolver = resolve;
      $('matureModal').classList.remove('hidden');
    });
  }

  function closeMatureModal() {
    $('matureModal').classList.add('hidden');
  }

  function resolveMature(ok) {
    if (matureResolver) {
      const r = matureResolver;
      matureResolver = null;
      closeMatureModal();
      r(ok);
    }
  }

  function confirmMature() {
    if ($('matureRemember').checked) {
      sessionStorage.setItem('pf_mature_session', String(Date.now() + 60 * 60 * 1000));
    }
    // Reveal the current view right away (5s grace) even if not remembered.
    state.revealNow = Date.now() + 5000;
    refreshBatch();
    loadHistory();
    renderLightbox();
    resolveMature(true);
  }

  /** Re-render the current batch grid (e.g. after authorizing mature content). */
  function refreshBatch() {
    state.batch.forEach((item, i) => {
      if (item) fillTile(i, item.entry, item.url);
    });
  }

  /* ---------------- batch toolbar (download all) ---------------- */
  function updateDlAll() {
    const items = state.batch.filter(Boolean);
    const n = items.length;
    const bar = $('resultToolbar');
    if (n === 0) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    $('dlAllInfo').textContent = n + (n === 1 ? ' file ready' : ' files ready');
    $('dlAllBtn').textContent = '⬇ Download all (' + n + ')';
  }

  async function downloadAll() {
    const items = state.batch.filter(Boolean);
    if (!items.length) return;
    const btn = $('dlAllBtn');
    btn.disabled = true;
    btn.textContent = 'Zipping…';
    try {
      const fd = new FormData();
      fd.append('action', 'download_all');
      fd.append('ids', items.map((it) => it.entry.id).join(','));
      csrfAppend(fd);
      const r = await fetch('api.php', { method: 'POST', body: fd });
      if (!r.ok) {
        let msg = 'ZIP download failed (' + r.status + ').';
        try {
          const d = await r.json();
          if (d && d.error) msg = d.error;
        } catch (e) { /* not JSON */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pixelforge-batch-' + items.length + '.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('⬇ Batch zip downloaded (' + items.length + ' images)!');
    } catch (e) {
      toast(friendlyError(e), true);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ Download all (' + state.batch.filter(Boolean).length + ')';
    }
  }

  /** Cap the result grid to ~2 rows; extra images scroll inside it. */
  function capGridRows() {
    const grid = $('resultGrid');
    const tile = grid.querySelector('.tile');
    if (!tile) return;
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.rowGap) || 14;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    grid.style.maxHeight = Math.round(tile.offsetHeight * 2 + gap + padTop + padBottom) + 'px';
  }

  /* ---------------- custom resolution ---------------- */

  /** Snap a pixel value into the free engine's range: 64px steps, 256-768. */
  function snapDim(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 768;
    n = Math.max(256, Math.min(768, n));
    return Math.round(n / 64) * 64;
  }

  /** Show/hide the custom W×H row to match the current resolution choice. */
  function syncCustomResRow() {
    const row = $('customResRow');
    if (!row) return;
    row.classList.toggle('hidden', state.resolution !== 'custom');
  }

  /* ---------------- result area ---------------- */
  function setStatus(text) {
    if (text === null) {
      $('resultStatus').classList.add('hidden');
      const bp = $('batchProgress');
      if (bp) bp.classList.add('hidden');
      return;
    }
    $('resultStatus').classList.remove('hidden');
    $('loadStatusText').textContent = text;
  }

  /* Batch progress bar + ETA. done/total are image counts; the ETA is derived
     from the average time per finished image. */
  function setBatchProgress(done, total) {
    const bar = $('batchProgress');
    if (!bar) return;
    if (total <= 0 || done >= total) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    const pct = Math.min(100, Math.round((done / total) * 100));
    $('bpFill').style.width = pct + '%';
    $('bpCount').textContent = done + ' / ' + total;
    if (done > 0 && batchT0) {
      const avgMs = (Date.now() - batchT0) / done;
      const remSec = Math.max(0, Math.round((avgMs * (total - done)) / 1000));
      const m = Math.floor(remSec / 60);
      $('bpEta').textContent = m > 0
        ? '~' + m + ':' + String(remSec % 60).padStart(2, '0') + ' left'
        : '~' + remSec + 's left';
    } else {
      $('bpEta').textContent = '—';
    }
  }

  function showEmpty() {
    $('resultGrid').classList.add('hidden');
    setStatus(null);
    // In story mode the story panel owns the result area.
    if (state.mode === 'story') {
      $('storyScenes').classList.remove('hidden');
      $('resultEmpty').classList.add('hidden');
    } else {
      $('resultEmpty').classList.remove('hidden');
    }
    updateDlAll();
  }

  /** Result grid layout: a single image gets a full-width hero tile;
      batches of 2+ go two per row. */
  function colsFor(count) {
    if (count <= 1) return 1;   // single hero tile
    return 2;                   // 2+ images: two per row
  }

  function startBatch(count) {
    state.batch = [];
    $('resultEmpty').classList.add('hidden');
    setStatus('Preparing…');
    const grid = $('resultGrid');
    grid.classList.remove('hidden');
    grid.className = 'result-grid cols-' + colsFor(count);
    grid.innerHTML = '';
    $('resultToolbar').classList.add('hidden');
    for (let i = 0; i < count; i++) {
      const t = document.createElement('div');
      t.className = 'tile tile-skeleton';
      t.innerHTML = '<span class="tile-order">' + (i + 1) + '</span>';
      grid.appendChild(t);
    }
    capGridRows();
  }

  function mkBtn(label, title, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile-btn';
    b.title = title;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  /** "768x768" -> "768×768"; anything else shows a dash until media loads. */
  function sizeLabelFor(entry) {
    const r = String((entry && entry.resolution) || '');
    return /^\d{1,5}x\d{1,5}$/.test(r) ? r.replace('x', '×') : '—';
  }

  function fillTile(i, entry, url) {
    const grid = $('resultGrid');
    const t = grid.children[i] || document.createElement('div');
    t.className = 'tile';
    t.innerHTML = '';

    const img = mediaEl(entry, url, true);
    // Tiles now take the image's natural aspect ratio, so re-measure the
    // grid's row cap once the media is actually loaded (its real height).
    // Also stamp the true decoded pixel size (may differ from the requested
    // resolution when the engine caps or upscales).
    const loadEvt = entry.type === 'video' ? 'loadeddata' : 'load';
    img.addEventListener(loadEvt, () => {
      const w = entry.type === 'video' ? img.videoWidth : img.naturalWidth;
      const h = entry.type === 'video' ? img.videoHeight : img.naturalHeight;
      if (w > 0 && h > 0) size.textContent = w + '×' + h;
      capGridRows();
    });

    const order = document.createElement('span');
    order.className = 'tile-order';
    order.textContent = String(i + 1);

    const mature = isGated(entry);
    t.classList.toggle('tile-mature', mature);

    const ov = document.createElement('div');
    ov.className = 'tile-overlay';

    const seed = document.createElement('span');
    seed.className = 'tile-seed';
    seed.textContent = 'Seed ' + entry.seed;

    // Actual generated pixel size, bottom-left of the tile.
    const size = document.createElement('span');
    size.className = 'tile-size';
    size.textContent = sizeLabelFor(entry);

    const acts = document.createElement('div');
    acts.className = 'tile-actions';
    acts.appendChild(mkBtn('⬇', 'Download', (e) => { e.stopPropagation(); triggerDownload(entry); }));
    acts.appendChild(mkBtn('🗑', 'Delete', (e) => { e.stopPropagation(); deleteItem(entry.id); }));

    // Bottom row: size chip on the left, action buttons on the right.
    const bottom = document.createElement('div');
    bottom.className = 'tile-bottom';
    bottom.appendChild(size);
    bottom.appendChild(acts);

    ov.appendChild(seed);
    ov.appendChild(bottom);
    t.appendChild(img);
    t.appendChild(order);
    t.appendChild(ov);

    if (mature) {
      const badge = document.createElement('span');
      badge.className = 'tile-mature-badge';
      badge.textContent = '⚠️ Mature · click to reveal';
      t.appendChild(badge);
    }

    t.addEventListener('click', async () => {
      if (isGated(entry)) {
        const ok = await askMature();
        if (!ok) return;
      }
      const items = state.batch.filter(Boolean);
      const idx = items.findIndex((it) => it.entry.id === entry.id);
      if (idx >= 0) openLightbox(items, idx);
    });

    if (grid.contains(t)) grid.replaceChild(t, grid.children[i]);
    else grid.appendChild(t);
    capGridRows();
  }

  function failTile(i, message) {
    const grid = $('resultGrid');
    const t = grid.children[i];
    if (!t) return;
    t.className = 'tile tile-failed';
    t.innerHTML = '';
    const x = document.createElement('span');
    x.className = 'tile-fail-x';
    x.textContent = '✕';
    const note = document.createElement('span');
    note.className = 'tile-fail-note';
    note.textContent = 'failed';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'tile-retry';
    retry.textContent = '↻ Retry';
    retry.addEventListener('click', (e) => {
      e.stopPropagation();
      retryTile(i);
    });
    t.title = message || 'Generation failed';
    t.appendChild(x);
    t.appendChild(note);
    t.appendChild(retry);
  }

  /* ---------------- mode-aware UI copy ---------------- */

  /** The Forge button's label for the current mode. */
  function genLabel() {
    if (state.mode === 'video') return '🎬 Generate Video';
    if (state.mode === '3d') return '🌀 Render 3D';
    return 'Forge Images';
  }

  /* ---------------- generation ---------------- */
  /**
   * Generate one image, retrying transient failures automatically.
   * Same seed is reused across attempts so a recovered result stays
   * consistent. onRetry(attempt) fires before each retry. isCancelled(),
   * when provided, aborts the remaining retries (e.g. the Stop button).
   */
  async function generateOne(prompt, seed, attempts = AUTO_RETRIES, onRetry = null, isCancelled = null, signal = null, refUrl = state.ref.url, sync = false) {
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const fd = new FormData();
        fd.append('action', 'generate');
        csrfAppend(fd);
        fd.append('prompt', prompt);
        fd.append('negative', $('negative').value.trim());
        fd.append('style', state.style);
        // Full-body refs force Portrait; otherwise send the chosen resolution
        // (a preset key, or 'custom' plus its W/H fields).
        const resolution = (state.mode === 'image' && state.ref.fullBody && state.ref.url)
          ? 'portrait'
          : state.resolution;
        fd.append('resolution', resolution);
        if (resolution === 'custom') {
          fd.append('res_w', String(snapDim($('resW').value)));
          fd.append('res_h', String(snapDim($('resH').value)));
        }
        fd.append('guidance', $('guidance').value);
        fd.append('seed', String(seed));
        // Story mode renders its scene images onto a same-origin canvas, so
        // it needs the local file ready before the response returns.
        if (sync) fd.append('sync', '1');
        if (state.mode === 'image' && refUrl) {
          fd.append('ref_url', refUrl);
          fd.append('ref_blur', String(state.ref.blur));
          fd.append('engine', state.ref.engine); // 'local' | 'free' | 'ai'
        }
        // Run through the request queue so two heavy generations can never
        // hit the free service concurrently (e.g. Ctrl+Enter racing a batch).
        const item = await enqueueRequest(async () => {
          const r = await fetch('api.php', { method: 'POST', body: fd, signal: signal || undefined });
          const d = await r.json();
          if (!d.ok) throw new Error(d.error || 'Generation failed.');
          return d;
        });
        // A success means the free engine recovered — sync the header pill.
        if ($('statusPill').classList.contains('status-busy')) checkStatus();
        return { entry: item.image, url: item.url, duplicate: !!item.duplicate, note: item.note || '' };
      } catch (e) {
        // Stop was pressed — the request was aborted; cut out instantly, no retries.
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        // The free service queues generations on a shared channel. Flag a busy
        // queue on EVERY failure (including the final attempt) so the header
        // pill turns amber the moment the service is under load.
        const queueBusy = /queue is busy/.test(e.message || '');
        if (queueBusy) markServiceBusy();
        if (attempt < attempts) {
          if (isCancelled && isCancelled()) break; // user stopped — give up quietly
          if (onRetry) onRetry(attempt);
          // When the queue is busy, wait a real backoff so a busy minute
          // resolves into a success instead of a red failed tile.
          const pause = queueBusy ? 10000 * attempt : 1200 * attempt;
          await new Promise((res) => setTimeout(res, pause));
        }
      }
    }
    throw lastErr;
  }

  async function generate() {
    await ensureCsrf();
    // The same button doubles as STOP while a batch is forging. Video renders
    // also set state.busy, so only treat an active image/repaint batch as
    // stop-able — Ctrl+Enter while a video renders must not abort it.
    if (state.busy) {
      if (state.mode === 'video') {
        toast('A video is still rendering — wait for it to finish.');
        return;
      }
      stopForging();
      return;
    }
    if (state.mode === 'video') {
      generateVideo();
      return;
    }
    if (state.mode === '3d') {
      render3DVideo();
      return;
    }
    // Local repaints: instant (browser canvas), prompt is optional.
    if (state.mode === 'image' && state.ref.url && state.ref.engine === 'local') {
      repaintBatch();
      return;
    }
    const prompt = $('prompt').value.trim();
    if (!prompt) {
      toast('Please describe the image you want first.', true);
      $('prompt').focus();
      return;
    }
    // AI repaints need the prompt + a saved HuggingFace token.
    if (state.mode === 'image' && state.ref.url && state.ref.engine === 'ai' && !state.hfKey) {
      toast('AI Repaint needs a HuggingFace token — enter one below the reference image (free).', true);
      $('refAiRow').classList.remove('hidden');
      openRefPanel();
      $('hfKey').focus();
      return;
    }
    saveSession();

    // Full body: anchor the headshot on a tall 2:3 canvas first so the AI can
    // outpaint the body below it (keyless free engine).
    let refUrl = state.ref.url;
    if (state.ref.fullBody && state.ref.url) {
      setStatus('Composing full-body canvas…');
      try {
        refUrl = await composeFullBody(state.ref.url);
      } catch (e) {
        setStatus(null); // don't leave the status row stuck on 'Composing…'
        toast(friendlyError(e), true);
        return;
      }
    }

    const count = state.count;
    const baseSeed = parseInt($('seed').value, 10);
    state.busy = true;
    state.abort = new AbortController();
    let stopped = false;

    const btn = $('genBtn');
    btn.classList.add('stop');
    btn.title = 'Stop the current batch';
    btn.querySelector('.gen-icon').textContent = '⏹';
    btn.querySelector('.gen-label').textContent = 'Stop';
    startBatch(count);
    batchT0 = Date.now();
    setBatchProgress(0, count);

    const results = [];
    for (let i = 0; i < count; i++) {
      if (!state.busy) {
        stopped = true;
        break;
      }
      setStatus('Forging image ' + (i + 1) + ' of ' + count + '…');
      try {
        const seed = baseSeed >= 0 ? baseSeed + i : -1;
        const item = await generateOne(prompt, seed, AUTO_RETRIES, (attempt) => {
          if (state.busy) setStatus('Image ' + (i + 1) + ' failed — retrying (' + attempt + '/' + AUTO_RETRIES + ')…');
        }, () => !state.busy, state.abort.signal, refUrl);
        fillTile(i, item.entry, item.url);
        while (state.batch.length <= i) state.batch.push(null);
        state.batch[i] = item;
        results.push(item);
      } catch (e) {
        // Stop pressed — end the batch now instead of showing a failure tile.
        if (e.name === 'AbortError' || !state.busy) {
          stopped = true;
          break;
        }
        failTile(i, friendlyError(e));
        toast('Image ' + (i + 1) + ' failed: ' + friendlyError(e), true);
      }
      setBatchProgress(i + 1, count);
    }

    btn.disabled = false;
    btn.classList.remove('busy', 'stop');
    btn.title = '';
    btn.querySelector('.gen-icon').textContent = '⚡';
    btn.querySelector('.gen-label').textContent = genLabel();
    state.busy = false;
    state.abort = null;
    updateDlAll();

    if (stopped) {
      // Drop the skeleton tiles for images we never forged.
      $('resultGrid').querySelectorAll('.tile-skeleton').forEach((el) => el.remove());
      if (results.length === 0) showEmpty();
      setStatus(null);
      toast('⏹ Stopped — ' + results.length + (results.length === 1 ? ' image' : ' images') + ' saved.');
      loadHistory();
      $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    if (results.length === 0) {
      setStatus(null);
      toast('Nothing was forged. Try again.', true);
      return;
    }
    setStatus(null);
    const reused = results.filter((it) => it && it.duplicate).length;
    const forged = results.length - reused;
    // The engine may have capped a custom size — surface its note.
    const note = [...new Set(results.map((it) => it && it.note).filter(Boolean))];
    toast('⚡ ' + forged + (forged === 1 ? ' image forged!' : ' images forged!') +
      (reused ? ' · ' + reused + ' reused from history' : '') +
      (note.length ? ' · ' + note[0] : ''));
    savePromptHistoryEntry(prompt);
    loadHistory();
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Build the media element (image or video) for tiles / history / lightbox. */
  function mediaEl(entry, url, autoplay = false) {
    if (entry.type === 'video') {
      const v = document.createElement('video');
      v.controls = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'metadata';
      if (autoplay) v.autoplay = true;
      v.src = url;
      return v;
    }
    const i = document.createElement('img');
    i.loading = 'lazy';
    i.alt = entry.prompt;
    i.src = url;
    return i;
  }

  /** Render a single text-to-video — keyless free engine or Replicate (start + poll). */
  async function generateVideo() {
    await ensureCsrf();
    const prompt = $('prompt').value.trim();
    if (!prompt) {
      toast('Please describe the video you want first.', true);
      $('prompt').focus();
      return;
    }
    if (state.videoEngine === 'replicate' && !state.videoKey) {
      toast('The Replicate engine needs an API key — pick “Free · no key” above, or paste an r8_ key.', true);
      return;
    }
    if (state.busy) return;
    state.busy = true;

    const btn = $('genBtn');
    btn.disabled = true;
    btn.querySelector('.gen-label').textContent = 'Rendering…';
    startBatch(1);
    setStatus(state.videoEngine === 'free' ? 'Generating video (free engine)…' : 'Starting video render…');

    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('style', state.style);

    const startedAt = Date.now();
    const tick = setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      setStatus((state.videoEngine === 'free' ? 'Generating video (free engine)… ' : 'Rendering video… ') + '(' + secs + 's)');
    }, 5000);

    try {
      if (state.videoEngine === 'free') {
        // Keyless engine: one blocking request, the MP4 comes back ready.
        fd.append('action', 'video_free');
        csrfAppend(fd);
        // The free engine is shared with image generation — never overlap.
        const d = await enqueueRequest(async () => {
          const r = await fetch('api.php', { method: 'POST', body: fd });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error);
          return j;
        });
        state.batch[0] = { entry: d.entry, url: d.url };
        fillTile(0, d.entry, d.url);
        toast('🎬 Video generated!');
        loadHistory();
      } else {
        fd.append('action', 'video_start');
        csrfAppend(fd);
        const r = await fetch('api.php', { method: 'POST', body: fd });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error);
        const id = d.id;

        let done = false;
        for (let i = 0; i < 120 && !done; i++) {
          const r2 = await fetch('api.php?action=video_status&id=' + encodeURIComponent(id) +
            '&prompt=' + encodeURIComponent(prompt) + '&style=' + encodeURIComponent(state.style));
          const d2 = await r2.json();
          if (!d2.ok) throw new Error(d2.error);
          if (d2.status === 'done') {
            state.batch[0] = { entry: d2.entry, url: d2.url };
            fillTile(0, d2.entry, d2.url);
            toast('🎬 Video rendered!');
            loadHistory();
            done = true;
            break;
          }
          if (d2.status === 'failed') throw new Error(d2.error || 'Video render failed.');
          if (d2.status === 'gone') throw new Error('The render request expired — try again.');
          await new Promise((res) => setTimeout(res, 5000));
        }
        if (!done) throw new Error('Video render timed out — try again.');
      }
    } catch (e) {
      failTile(0, friendlyError(e));
      toast(friendlyError(e), true);
    } finally {
      clearInterval(tick);
      btn.disabled = false;
      btn.querySelector('.gen-label').textContent = genLabel();
      state.busy = false;
      setStatus(null);
      updateDlAll();
    }
  }

  /** Stop the current batch — aborts the in-flight request instantly. */
  function stopForging() {
    if (!state.busy) return;
    state.busy = false;
    if (state.abort) state.abort.abort();
    const btn = $('genBtn');
    btn.disabled = true;
    btn.querySelector('.gen-label').textContent = 'Stopping…';
    setStatus('Stopping…');
  }

  async function retryTile(i) {
    // Local repaints are re-rendered in the browser, not re-forged remotely.
    if (state.mode === 'image' && state.ref.url && state.ref.engine === 'local') {
      repaintTile(i);
      return;
    }
    const prompt = $('prompt').value.trim();
    if (!prompt || state.busy) return;
    const baseSeed = parseInt($('seed').value, 10);
    state.busy = true;
    const btn = $('genBtn');
    btn.disabled = true;
    btn.classList.add('busy');
    btn.querySelector('.gen-label').textContent = 'Retrying…';
    setStatus('Retrying image ' + (i + 1) + '…');
    let refUrl = state.ref.url;
    if (state.ref.fullBody && state.ref.url) {
      setStatus('Composing full-body canvas…');
      try {
        refUrl = await composeFullBody(state.ref.url);
      } catch (e) {
        toast(friendlyError(e), true);
        state.busy = false;
        btn.disabled = false;
        btn.classList.remove('busy');
        btn.querySelector('.gen-label').textContent = genLabel();
        setStatus(null);
        return;
      }
    }
    try {
      const seed = baseSeed >= 0 ? baseSeed + i : -1;
      const item = await generateOne(prompt, seed, AUTO_RETRIES, (attempt) => {
        setStatus('Image ' + (i + 1) + ' failed — retrying (' + attempt + '/' + AUTO_RETRIES + ')…');
      }, null, null, refUrl);
      fillTile(i, item.entry, item.url);
      while (state.batch.length <= i) state.batch.push(null);
      state.batch[i] = item;
      setStatus(null);
      toast('Image ' + (i + 1) + ' forged!' + (item.note ? ' · ' + item.note : ''));
    } catch (e) {
      failTile(i, friendlyError(e));
      toast('Retry failed: ' + friendlyError(e), true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.querySelector('.gen-label').textContent = genLabel();
      state.busy = false;
      updateDlAll();
    }
  }

  /** POST a rendered repaint data URL to the server and get its history entry. */
  async function saveRepaint(dataUrl, signal = null) {
    const fd = new FormData();
    fd.append('action', 'repaint_save');
    csrfAppend(fd);
    fd.append('image', dataUrl);
    fd.append('style', state.ref.style);
    fd.append('blend', String(state.ref.blur));
    fd.append('prompt', $('prompt').value.trim());
    const r = await fetch('api.php', { method: 'POST', body: fd, signal: signal || undefined });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    return { entry: d.image, url: d.url, duplicate: !!d.duplicate };
  }

  /** Re-render one tile locally (same style, fresh jitter) and replace it. */
  async function repaintTile(i) {
    if (!state.ref.url || state.busy) return;
    state.busy = true;
    const btn = $('genBtn');
    btn.disabled = true;
    btn.classList.add('busy');
    btn.querySelector('.gen-label').textContent = 'Repainting…';
    setStatus('Repainting image ' + (i + 1) + '…');
    try {
      const img = await loadRefImage();
      const jit = jitterFor(i, parseInt($('seed').value, 10));
      const dataUrl = applyRepaint(img, state.ref.style, state.ref.blur, jit);
      const item = await saveRepaint(dataUrl);
      fillTile(i, item.entry, item.url);
      while (state.batch.length <= i) state.batch.push(null);
      state.batch[i] = item;
      setStatus(null);
      toast('Image ' + (i + 1) + ' repainted!');
    } catch (e) {
      failTile(i, friendlyError(e));
      toast('Repaint failed: ' + friendlyError(e), true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.querySelector('.gen-label').textContent = genLabel();
      state.busy = false;
      updateDlAll();
    }
  }

  /* ---------------- reference image (repaint / img2img) ---------------- */

  /** Downscale + JPEG-encode a local image so it uploads fast as a data URL. */
  function downscaleRefImage(file, maxDim = 1024, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(new Error('Could not encode that image.'));
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  /** Compose a headshot onto a tall 2:3 canvas (512×768) so the free img2img
      engine can outpaint a full body below it. The face is anchored at the top
      over a soft gradient that fades to neutral gray — the model's cue that
      this area is free to invent. Returns a JPEG data URL. */
  function composeFullBody(dataUrl) {
    return new Promise((resolve, reject) => {
      const W = 512, H = 768;
      const img = new Image();
      img.onload = () => {
        try {
          const c = makeCanvas(W, H);
          const ctx = c.getContext('2d');
          // Background: a vertical gradient tinted by the photo's average color,
          // fading to a neutral studio gray toward the bottom (the body zone).
          const avg = averageColor(img);
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, 'rgb(' + avg[0] + ',' + avg[1] + ',' + avg[2] + ')');
          g.addColorStop(1, 'rgb(192,196,202)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          // Face anchored top-center, scaled to fill the upper ~52% of the frame.
          const regionH = H * 0.52;
          const scale = Math.min(W / img.width, regionH / img.height);
          const dw = Math.round(img.width * scale);
          const dh = Math.round(img.height * scale);
          ctx.drawImage(img, Math.round((W - dw) / 2), 0, dw, dh);
          // Soft seam fade just below the face so the model blends smoothly
          // instead of leaving a hard photo edge.
          const fadeTop = dh;
          const fadeBot = Math.min(H, dh + 96);
          const fade = ctx.createLinearGradient(0, fadeTop, 0, fadeBot);
          fade.addColorStop(0, 'rgba(192,196,202,0)');
          fade.addColorStop(1, 'rgba(192,196,202,1)');
          ctx.fillStyle = fade;
          ctx.fillRect(0, fadeTop, W, fadeBot - fadeTop);
          resolve(c.toDataURL('image/jpeg', 0.9));
        } catch (e) {
          reject(new Error('Could not compose the full-body canvas.'));
        }
      };
      img.onerror = () => reject(new Error('Could not load the photo for full-body composition.'));
      img.src = dataUrl;
    });
  }

  /** Average RGB of an image, used to tint the full-body canvas background. */
  function averageColor(img) {
    const c = makeCanvas(8, 8);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  async function setRefImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('Please choose an image file.', true);
      return;
    }
    try {
      const dataUrl = await downscaleRefImage(file);
      state.ref.url = dataUrl;
      if (!$('prompt').dataset.origPlaceholder) {
        $('prompt').dataset.origPlaceholder = $('prompt').placeholder;
      }
      updateRefUi();
      openRefPanel();
      toast(state.ref.engine === 'ai'
        ? '🖼 Reference ready — describe the change in the Prompt box, then Forge (AI Repaint).'
        : state.ref.engine === 'free'
          ? '🖼 Reference ready — describe the change in the Prompt box, then Forge (free, no token).'
          : '🖼 Reference ready — pick a repaint style and hit Forge!');
    } catch (e) {
      toast(friendlyError(e), true);
    }
  }

  function clearRefImage() {
    state.ref.url = '';
    $('refFile').value = '';
    updateRefUi();
  }

  /** Open the reference-image panel (collapsed by default). */
  function openRefPanel() {
    const p = $('refPanel');
    if (p) p.open = true;
  }

  /** Keep the reference section's controls in sync with state. */
  function updateRefUi() {
    const has = !!state.ref.url;
    const ai = has && state.ref.engine === 'ai';
    const free = has && state.ref.engine === 'free';
    const fb = has && state.ref.fullBody;
    $('refPreview').src = has ? state.ref.url : '';
    $('refDrop').classList.toggle('hidden', has);
    $('refPreviewWrap').classList.toggle('hidden', !has);
    $('refStyleRow').classList.toggle('hidden', !has);
    $('refStrengthRow').classList.toggle('hidden', !has);
    $('refStyle').value = state.ref.style;
    $('refAiRow').classList.toggle('hidden', !ai);
    $('hfKeyInputRow').classList.toggle('hidden', ai && state.hfKey);
    $('hfKeyManage').classList.toggle('hidden', !(ai && state.hfKey));
    $('refBlurLabel').textContent = (ai || free) ? 'Match strength' : 'Blend strength';
    $('refFullBodyRow').classList.toggle('hidden', !has);
    $('refFullBody').checked = !!state.ref.fullBody;
    // Contextual tip lives on the repaint-style control (hover tooltip).
    $('refStyle').title = (ai || free)
      ? (fb
          ? 'Describe the body in the Prompt box — e.g. "standing, wearing a red dress, sunset beach". Your face stays.'
          : 'Describe the change in the Prompt box — e.g. "make it an oil painting", "add a sunset sky".')
      : 'Pick a style and hit Forge — the effect applies instantly. The Prompt box is optional for local repaints.';
    if (!has) {
      $('prompt').placeholder = $('prompt').dataset.origPlaceholder || $('prompt').placeholder;
    } else if (ai || free) {
      $('prompt').placeholder = fb
        ? 'Describe the body — e.g. “standing, wearing a navy suit, city street at dusk”…'
        : 'Describe the change — e.g. “turn this into an oil painting”';
    } else {
      $('prompt').placeholder = 'Optional note about this repaint (unused by the effect)';
    }
  }

  function bindRef() {
    const drop = $('refDrop');
    $('refFile').addEventListener('change', (e) => setRefImage(e.target.files[0]));
    $('refRemove').addEventListener('click', clearRefImage);
    $('refStyle').addEventListener('change', () => {
      state.ref.style = $('refStyle').value;
      state.ref.engine = state.ref.style === 'ai' ? 'ai' : (state.ref.style === 'free' ? 'free' : 'local');
      updateRefUi();
      saveSession();
    });
    $('refBlur').addEventListener('input', () => {
      // UI slider is 0-100; the backend expects 0-1.
      state.ref.blur = (parseInt($('refBlur').value, 10) || 50) / 100;
      $('refBlurVal').textContent = $('refBlur').value;
      saveSession();
    });
    $('refFullBody').addEventListener('change', () => {
      state.ref.fullBody = $('refFullBody').checked;
      // A headshot needs the model room to invent the body: a mid-low match
      // strength keeps the face while freeing the space below.
      if (state.ref.fullBody) {
        $('refBlur').value = '40';
        state.ref.blur = 0.4;
        $('refBlurVal').textContent = '40';
      }
      updateRefUi();
      saveSession();
    });
    $('hfKeySave').addEventListener('click', saveHfKey);
    $('hfKeyClear').addEventListener('click', clearHfKey);
    ['dragover', 'dragenter'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('ref-drag');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('ref-drag');
      });
    });
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setRefImage(f);
    });
  }

  /** Remove the saved HuggingFace token (AI Repaint disabled until re-added). */
  async function clearHfKey() {
    const ok = await askConfirm({
      title: 'Remove HuggingFace token?',
      message: 'AI Repaint will be disabled until you add a token again.',
      yesLabel: 'Remove',
    });
    if (!ok) return;
    try {
      const fd = new FormData();
      fd.append('action', 'hfkey');
      csrfAppend(fd);
      fd.append('clear', '1');
      const r = await fetch('api.php', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      state.hfKey = false;
      updateRefUi();
      toast('HuggingFace token removed.');
    } catch (e) {
      toast(friendlyError(e), true);
    }
  }

  /** Save (or clear) the HuggingFace token for AI Repaint. */
  async function saveHfKey() {
    const key = $('hfKey').value.trim();
    if (!key) {
      toast('Paste your HuggingFace token first (starts with hf_).', true);
      return;
    }
    if (!/^hf_[A-Za-z0-9]+$/.test(key)) {
      toast('That does not look like a HuggingFace token (starts with hf_).', true);
      return;
    }
    const btn = $('hfKeySave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const fd = new FormData();
      fd.append('action', 'hfkey');
      csrfAppend(fd);
      fd.append('key', key);
      const r = await fetch('api.php', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      state.hfKey = true;
      $('hfKey').value = '';
      updateRefUi();
      toast('✅ HuggingFace token saved — AI Repaint unlocked!');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }

  /* ---------------- local repaint engine (browser canvas) ---------------- */

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function loadRefImage() {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Could not load the reference image.'));
      im.src = state.ref.url;
    });
  }

  /** Deterministic-ish per-tile jitter so a batch feels varied. */
  function jitterFor(i, seed) {
    const s = (seed >= 0 ? seed : (Date.now() % 100000)) + i * 7919;
    const rnd = (n) => {
      const v = Math.sin(s * (n + 1)) * 10000;
      return v - Math.floor(v); // 0..1
    };
    return { t: rnd(1), b: rnd(2), l: rnd(3), s: rnd(4) };
  }

  /* Some browsers (Safari < 18) don't support ctx.filter — fall back to
     pixel math so repaints still produce a visible, correct effect. */
  const CANVAS_FILTER = (() => {
    try {
      return typeof document.createElement('canvas').getContext('2d').filter !== 'undefined';
    } catch (e) { return false; }
  })();

  function parseFilter(f) {
    const specs = {};
    if (/grayscale/.test(f)) specs.grayscale = true;
    if (/invert/.test(f)) specs.invert = true;
    const sep = f.match(/sepia\(([\d.]+)\)/);   if (sep) specs.sepia = parseFloat(sep[1]);
    const sat = f.match(/saturate\(([\d.]+)\)/); if (sat) specs.saturate = parseFloat(sat[1]);
    const bri = f.match(/brightness\(([\d.]+)\)/); if (bri) specs.brightness = parseFloat(bri[1]);
    const con = f.match(/contrast\(([\d.]+)\)/); if (con) specs.contrast = parseFloat(con[1]);
    return specs;
  }

  function pixelFilter(base, specs) {
    const c = makeCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (specs.sepia) {
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        r += (sr - r) * specs.sepia; g += (sg - g) * specs.sepia; b += (sb - b) * specs.sepia;
      }
      if (specs.grayscale) { const gr = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = gr; }
      if (specs.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
      if (specs.saturate) {
        const gr = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gr + (r - gr) * specs.saturate; g = gr + (g - gr) * specs.saturate; b = gr + (b - gr) * specs.saturate;
      }
      if (specs.brightness) { r *= specs.brightness; g *= specs.brightness; b *= specs.brightness; }
      if (specs.contrast) { r = (r - 128) * specs.contrast + 128; g = (g - 128) * specs.contrast + 128; b = (b - 128) * specs.contrast + 128; }
      d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function fxFilter(base, filter) {
    if (!CANVAS_FILTER) return pixelFilter(base, parseFilter(filter));
    const c = makeCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.filter = filter;
    ctx.drawImage(base, 0, 0);
    ctx.filter = 'none';
    return c;
  }

  function fxOil(base, j) {
    let c = fxFilter(base, 'saturate(' + (1.3 + 0.2 * j.t).toFixed(2) + ') contrast(' + (1.14 + 0.08 * j.s).toFixed(2) + ')');
    if (CANVAS_FILTER) {
      const ctx = c.getContext('2d');
      ctx.filter = 'blur(1.2px)';
      ctx.globalAlpha = 0.65;
      ctx.drawImage(c, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
    }
    return c;
  }

  function fxSketch(base, j) {
    const gray = fxFilter(base, 'grayscale(1) contrast(1.15)');
    const blur = fxFilter(base, 'grayscale(1) contrast(1.15) blur(' + (2 + j.b * 2).toFixed(1) + 'px)');
    const gd = gray.getContext('2d').getImageData(0, 0, gray.width, gray.height);
    const bd = blur.getContext('2d').getImageData(0, 0, blur.width, blur.height);
    const d = gd.data, bl = bd.data;
    for (let i = 0; i < d.length; i += 4) {
      const bv = d[i];
      const invBlur = 255 - bl[i]; // inverted blurred (dodge blend)
      const v = Math.min(255, (bv * 255) / (invBlur === 255 ? 1 : (255 - invBlur)));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    gray.getContext('2d').putImageData(gd, 0, 0);
    return gray;
  }

  function fxWatercolor(base, j) {
    let c = fxFilter(base, 'saturate(' + (0.72 + 0.12 * j.t).toFixed(2) + ') brightness(1.07)');
    if (CANVAS_FILTER) {
      const ctx = c.getContext('2d');
      ctx.filter = 'blur(' + (1.6 + j.b).toFixed(1) + 'px)';
      ctx.drawImage(c, 0, 0);
      ctx.globalCompositeOperation = 'lighten';
      ctx.filter = 'blur(2.5px) brightness(1.14)';
      ctx.drawImage(c, 0, 0);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
    }
    return c;
  }

  function posterize(base, levels, sat) {
    const c = makeCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const q = 255 / levels;
    for (let i = 0; i < d.length; i += 4) {
      const r = Math.round(d[i] / q) * q;
      const g = Math.round(d[i + 1] / q) * q;
      const b = Math.round(d[i + 2] / q) * q;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i]     = Math.min(255, gray + (r - gray) * sat);
      d[i + 1] = Math.min(255, gray + (g - gray) * sat);
      d[i + 2] = Math.min(255, gray + (b - gray) * sat);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function fxPop(base, j) {
    return posterize(base, 3 + Math.round(j.l), 1.6 + j.t);
  }

  function fxPixel(base, j) {
    const block = 22 + Math.round(j.b * 26); // 22-48 px blocks
    const tw = Math.max(8, Math.round(base.width / block));
    const th = Math.max(8, Math.round(base.height / block));
    const t = makeCanvas(tw, th);
    const tctx = t.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(base, 0, 0, tw, th);
    const c = makeCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0, c.width, c.height);
    return c;
  }

  function fxMosaic(base, j) {
    const block = 18 + Math.round(j.b * 22);
    const c = makeCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const W = c.width, H = c.height;
    for (let y = 0; y < H; y += block) {
      for (let x = 0; x < W; x += block) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let jj = y; jj < Math.min(y + block, H); jj++) {
          for (let ii = x; ii < Math.min(x + block, W); ii++) {
            const p = (jj * W + ii) * 4;
            r += d[p]; g += d[p + 1]; b += d[p + 2]; n++;
          }
        }
        r /= n; g /= n; b /= n;
        for (let jj = y; jj < Math.min(y + block, H); jj++) {
          for (let ii = x; ii < Math.min(x + block, W); ii++) {
            const p = (jj * W + ii) * 4;
            d[p] = r; d[p + 1] = g; d[p + 2] = b;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function fxVintage(base, j) {
    const c = fxFilter(base, 'sepia(' + (0.55 + 0.15 * j.t).toFixed(2) + ') contrast(1.05) brightness(1.03)');
    const ctx = c.getContext('2d');
    const rad = Math.max(c.width, c.height) * 0.75;
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.45, c.width / 2, c.height / 2, rad);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(30,20,10,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const grain = 14 * (0.5 + 0.5 * j.t);
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() * 2 - 1) * grain;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function fxGlow(base, j) {
    const c = makeCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    if (CANVAS_FILTER) {
      const glow = fxFilter(base, 'blur(' + (6 + 4 * j.b).toFixed(1) + 'px) saturate(1.4)');
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(glow, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    return c;
  }

  /** Apply a repaint style to the reference and blend it back. Returns JPEG data URL. */
  function applyRepaint(img, style, blend, jit) {
    const base = makeCanvas(img.naturalWidth, img.naturalHeight);
    base.getContext('2d').drawImage(img, 0, 0);
    let fx;
    switch (style) {
      case 'sketch': fx = fxSketch(base, jit); break;
      case 'watercolor': fx = fxWatercolor(base, jit); break;
      case 'pop': fx = fxPop(base, jit); break;
      case 'pixel': fx = fxPixel(base, jit); break;
      case 'mosaic': fx = fxMosaic(base, jit); break;
      case 'vintage': fx = fxVintage(base, jit); break;
      case 'bw': fx = fxFilter(base, 'grayscale(1) contrast(1.12)'); break;
      case 'negative': fx = fxFilter(base, 'invert(1)'); break;
      case 'glow': fx = fxGlow(base, jit); break;
      default: fx = fxOil(base, jit);
    }
    const out = makeCanvas(img.naturalWidth, img.naturalHeight);
    const ctx = out.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, blend));
    ctx.drawImage(fx, 0, 0);
    ctx.globalAlpha = 1;
    return out.toDataURL('image/jpeg', 0.92);
  }

  /** Render a batch of local repaints (instant, browser-side) + save each to history. */
  async function repaintBatch() {
    saveSession();
    const count = state.count;
    const baseSeed = parseInt($('seed').value, 10);
    state.busy = true;
    state.abort = new AbortController();
    let stopped = false;
    const btn = $('genBtn');
    btn.classList.add('stop');
    btn.title = 'Stop the current batch';
    btn.querySelector('.gen-icon').textContent = '⏹';
    btn.querySelector('.gen-label').textContent = 'Stop';
    startBatch(count);
    batchT0 = Date.now();
    setBatchProgress(0, count);
    const results = [];

    const img = await loadRefImage().catch((e) => {
      toast(friendlyError(e), true);
      return null;
    });
    if (!img) {
      btn.disabled = false;
      btn.classList.remove('stop');
      btn.querySelector('.gen-icon').textContent = '⚡';
      btn.querySelector('.gen-label').textContent = genLabel();
      state.busy = false;
      state.abort = null;
      showEmpty();
      return;
    }

    for (let i = 0; i < count; i++) {
      if (!state.busy) { stopped = true; break; }
      setStatus('Repainting ' + (i + 1) + ' of ' + count + '…');
      try {
        const jit = jitterFor(i, baseSeed);
        const dataUrl = applyRepaint(img, state.ref.style, state.ref.blur, jit);
        // Let the browser breathe between tiles.
        await new Promise((r) => setTimeout(r, 80));
        const item = await saveRepaint(dataUrl, state.abort.signal);
        fillTile(i, item.entry, item.url);
        while (state.batch.length <= i) state.batch.push(null);
        state.batch[i] = item;
        results.push(item);
      } catch (e) {
        // Stop pressed — end the batch now.
        if (e.name === 'AbortError' || !state.busy) {
          stopped = true;
          break;
        }
        failTile(i, friendlyError(e));
        toast('Repaint ' + (i + 1) + ' failed: ' + friendlyError(e), true);
      }
      setBatchProgress(i + 1, count);
    }

    btn.disabled = false;
    btn.classList.remove('stop');
    btn.title = '';
    btn.querySelector('.gen-icon').textContent = '⚡';
    btn.querySelector('.gen-label').textContent = genLabel();
    state.busy = false;
    state.abort = null;
    updateDlAll();

    if (stopped) {
      $('resultGrid').querySelectorAll('.tile-skeleton').forEach((el) => el.remove());
      if (results.length === 0) showEmpty();
      setStatus(null);
      toast('⏹ Stopped — ' + results.length + (results.length === 1 ? ' repaint' : ' repaints') + ' saved.');
    } else if (results.length === 0) {
      setStatus(null);
      toast('Nothing was repainted. Try again.', true);
    } else {
      setStatus(null);
      toast('🖼 ' + results.length + (results.length === 1 ? ' repaint saved!' : ' repaints saved!'));
    }
    loadHistory();
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------------- story mode ---------------- */

  /** Populate the narrator voice dropdown (live list + fallback). */
  async function buildStoryVoices() {
    const sel = $('storyVoice');
    let items = null;
    try {
      const r = await fetch('api.php?action=voices');
      const d = await r.json();
      if (d.ok && d.items && d.items.length) items = d.items;
    } catch (e) { /* offline */ }
    if (!items) {
      items = [
        ['en-US-ChristopherNeural', 'Christopher · English (US) · Male'],
        ['en-US-JennyNeural', 'Jenny · English (US) · Female'],
        ['en-GB-RyanNeural', 'Ryan · English (UK) · Male'],
        ['en-KE-AsiliaNeural', 'Asilia · English (Kenya) · Female'],
        ['en-KE-ChilembaNeural', 'Chilemba · English (Kenya) · Male'],
        ['sw-KE-ZuriNeural', 'Zuri · Swahili (Kenya) · Female'],
      ].map(([voice, name]) => ({ voice, name }));
    }
    sel.innerHTML = '';
    items.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.voice;
      o.textContent = v.name;
      if (v.voice === state.story.voice) o.selected = true;
      sel.appendChild(o);
    });
    if (state.story.voice && ![...sel.options].some((o) => o.value === state.story.voice)) {
      sel.value = sel.options[0] ? sel.options[0].value : '';
    }
  }

  /** Split story text into scene chunks by the chosen rule. */
  function splitStoryText(text, rule) {
    const clean = text.replace(/\r\n/g, '\n').trim();
    let chunks = [];
    if (rule === 'paragraph') {
      chunks = clean.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
      if (chunks.length < 2) {
        chunks = clean.split('\n').map((p) => p.trim()).filter((p) => p.length > 0);
      }
    } else if (rule === 'sentence') {
      const parts = clean.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [];
      let cur = '';
      parts.forEach((p) => {
        const t = p.trim();
        if (!t) return;
        cur = cur ? cur + ' ' + t : t;
        if (cur.length >= 110) { chunks.push(cur); cur = ''; }
      });
      if (cur) chunks.push(cur);
    } else { // chars
      const parts = clean.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [clean];
      let cur = '';
      parts.forEach((p) => {
        const t = p.trim();
        if (!t) return;
        cur = cur ? cur + ' ' + t : t;
        if (cur.length >= 240) { chunks.push(cur); cur = ''; }
      });
      if (cur) chunks.push(cur);
    }
    return chunks.filter((c) => c.length > 0).map((c) => c.replace(/\s+/g, ' ').trim()).slice(0, 12);
  }

  /** The image prompt for a scene is auto-derived from its own text. */
  function scenePrompt(text) {
    return text.slice(0, 400);
  }

  function setSceneState(i, msg) {
    const s = state.story.scenes[i];
    if (!s) return;
    s.state = msg;
    renderStoryScenes();
  }

  /** Generate images + narration for every scene, then enable render. */
  async function generateStory() {
    await ensureCsrf();
    const text = $('storyText').value.trim();
    if (!text) {
      toast('Paste a story first.', true);
      $('storyText').focus();
      return;
    }
    if (state.storyBusy) return;
    const rule = $('splitRule').value;
    const scenes = splitStoryText(text, rule);
    if (scenes.length === 0) {
      toast('Could not split that into scenes.', true);
      return;
    }
    if (scenes.length > 12) {
      toast(scenes.length + ' scenes is a lot — max 12. Use "By paragraph" for fewer.', true);
      return;
    }

    state.storyBusy = true;
    state.story.scenes = scenes.map((t) => ({ text: t, imageUrl: '', audioUrl: '', state: 'Waiting…', entry: null }));
    $('resultEmpty').classList.add('hidden');
    $('storyScenes').classList.remove('hidden');
    $('storyPreviewWrap').classList.add('hidden');
    $('storyRenderBtn').disabled = true;
    renderStoryScenes();

    const btn = $('storyGenBtn');
    btn.disabled = true;
    btn.querySelector('.gen-label').textContent = 'Working…';
    setStatus('Preparing scenes…');

    for (let i = 0; i < state.story.scenes.length; i++) {
      if (state.mode !== 'story') break; // user switched modes — stop quietly
      const s = state.story.scenes[i];
      setSceneState(i, 'Forging image…');
      try {
        const item = await generateOne(scenePrompt(s.text), -1, AUTO_RETRIES, (attempt) => {
          setSceneState(i, 'Forging image… retrying (' + attempt + '/' + AUTO_RETRIES + ')');
        }, null, null, null, true);
        s.imageUrl = item.url;
        s.entry = item.entry;
        setSceneState(i, 'Narrating…');
        const audioUrl = await fetchTts(s.text, state.story.voice, $('storyRate').value);
        s.audioUrl = audioUrl;
        setSceneState(i, '');
      } catch (e) {
        setSceneState(i, 'Failed: ' + friendlyError(e));
      }
    }

    btn.disabled = false;
    btn.querySelector('.gen-label').textContent = 'Generate Scenes';
    state.storyBusy = false;
    setStatus(null);
    const okCount = state.story.scenes.filter((s) => s.imageUrl && s.audioUrl).length;
    updateStoryRenderState();
    toast('📖 ' + okCount + '/' + state.story.scenes.length + ' scenes ready.');
    saveSession();
  }

  /** Fetch a narrated MP3 clip for a scene (cached on the server). */
  async function fetchTts(text, voice, rate) {
    const fd = new FormData();
    fd.append('action', 'tts');
    csrfAppend(fd);
    fd.append('text', text);
    fd.append('voice', voice);
    fd.append('rate', rate);
    const r = await fetch('api.php', { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    return d.url;
  }

  /** Render the scene card grid (with inline state messages). */
  function renderStoryScenes() {
    const grid = $('storyScenes');
    grid.innerHTML = '';
    state.story.scenes.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'story-scene';

      const media = document.createElement('div');
      media.className = 'scene-media';
      if (s.imageUrl) {
        const img = document.createElement('img');
        img.src = s.imageUrl;
        img.alt = 'Scene ' + (i + 1);
        media.appendChild(img);
      }
      const num = document.createElement('span');
      num.className = 'scene-num';
      num.textContent = 'Scene ' + (i + 1);
      media.appendChild(num);

      const body = document.createElement('div');
      body.className = 'scene-body';
      const txt = document.createElement('div');
      txt.className = 'scene-text';
      txt.textContent = s.text;
      body.appendChild(txt);

      const acts = document.createElement('div');
      acts.className = 'scene-actions';
      acts.appendChild(mkBtn('▶', 'Play narration', (e) => { e.stopPropagation(); playSceneAudio(s.audioUrl); }));
      if (!s.audioUrl) {
        acts.appendChild(mkBtn('🔊', 'Retry narration', (e) => { e.stopPropagation(); retrySceneAudio(i); }));
      }
      acts.appendChild(mkBtn('🔁', 'Regenerate image', (e) => { e.stopPropagation(); regenSceneImage(i); }));
      acts.appendChild(mkBtn('✏️', 'Edit text', (e) => { e.stopPropagation(); editSceneText(i, txt); }));
      acts.appendChild(mkBtn('↑', 'Move up', (e) => { e.stopPropagation(); moveScene(i, -1); }));
      acts.appendChild(mkBtn('↓', 'Move down', (e) => { e.stopPropagation(); moveScene(i, 1); }));
      acts.appendChild(mkBtn('🗑', 'Remove scene', (e) => { e.stopPropagation(); removeScene(i); }));
      body.appendChild(acts);

      const st = document.createElement('div');
      st.className = 'scene-state';
      st.textContent = s.state || '';
      body.appendChild(st);

      card.appendChild(media);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  function playSceneAudio(url) {
    if (!url) { toast('Narration not ready yet.', true); return; }
    const a = new Audio(url);
    a.play().catch(() => {});
  }

  async function regenSceneImage(i) {
    const s = state.story.scenes[i];
    if (!s || state.storyBusy) return;
    setSceneState(i, 'Regenerating image…');
    try {
      const item = await generateOne(scenePrompt(s.text), -1, AUTO_RETRIES, (attempt) => {
        setSceneState(i, 'Regenerating… retrying (' + attempt + '/' + AUTO_RETRIES + ')');
      }, null, null, null, true);
      s.imageUrl = item.url;
      s.entry = item.entry;
      setSceneState(i, '');
      updateStoryRenderState();
      toast('Scene ' + (i + 1) + ' image regenerated.');
    } catch (e) {
      setSceneState(i, 'Failed: ' + friendlyError(e));
      toast('Image failed: ' + friendlyError(e), true);
    }
  }

  /** Retry narration for one scene without re-forging its image. */
  async function retrySceneAudio(i) {
    const s = state.story.scenes[i];
    if (!s || state.storyBusy) return;
    setSceneState(i, 'Narrating…');
    try {
      const audioUrl = await fetchTts(s.text, state.story.voice, $('storyRate').value);
      s.audioUrl = audioUrl;
      setSceneState(i, '');
      updateStoryRenderState();
      toast('Scene ' + (i + 1) + ' narration ready.');
    } catch (e) {
      setSceneState(i, 'Failed: ' + friendlyError(e));
      toast('Narration failed: ' + friendlyError(e), true);
    }
  }

  /** Enable the render button only when every scene has an image + narration. */
  function updateStoryRenderState() {
    const scenes = state.story.scenes;
    const ready = scenes.length > 0 && scenes.every((s) => s.imageUrl && s.audioUrl);
    $('storyRenderBtn').disabled = !ready || state.storyBusy;
  }

  function editSceneText(i, txtEl) {
    const s = state.story.scenes[i];
    if (!s) return;
    if (txtEl.querySelector('textarea')) return;
    const ta = document.createElement('textarea');
    ta.value = s.text;
    ta.rows = 3;
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'tile-btn';
    save.textContent = 'Save';
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      s.text = ta.value.trim() || s.text;
      saveSession();
      renderStoryScenes();
    });
    txtEl.classList.add('editing');
    txtEl.textContent = '';
    txtEl.appendChild(ta);
    txtEl.appendChild(save);
    ta.focus();
  }

  function moveScene(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= state.story.scenes.length) return;
    const arr = state.story.scenes;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderStoryScenes();
    saveSession();
  }

  async function removeScene(i) {
    const ok = await askConfirm({
      title: 'Remove this scene?',
      message: 'The scene will be dropped from the story. This cannot be undone.',
    });
    if (!ok) return;
    state.story.scenes.splice(i, 1);
    renderStoryScenes();
    if (!state.story.scenes.length) {
      $('storyScenes').classList.add('hidden');
      $('resultEmpty').classList.remove('hidden');
    }
    saveSession();
  }

  /** Wrap text into lines that fit the caption box width. */
  function wrapStoryText(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = t;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  /** Draw one scene frame: cover-fit image, Ken Burns zoom, caption. */
  function drawStoryFrame(ctx, w, h, img, text, p) {
    ctx.fillStyle = '#0b0b16';
    ctx.fillRect(0, 0, w, h);
    if (img && img.complete && img.naturalWidth) {
      const ir = img.naturalWidth / img.naturalHeight;
      const cr = w / h;
      let dw, dh;
      if (ir > cr) { dh = h; dw = h * ir; } else { dw = w; dh = w / ir; }
      const zoom = 1 + 0.1 * p; // slow Ken Burns zoom-in
      dw *= zoom; dh *= zoom;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    if (state.story.captions && text) {
      const fs = Math.max(18, Math.round(h * 0.045));
      ctx.font = '600 ' + fs + 'px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = w * 0.86;
      const lines = wrapStoryText(ctx, text, maxW);
      const lh = fs * 1.4;
      const pad = fs * 0.7;
      const boxH = lines.length * lh + pad * 2;
      const boxW = w * 0.92;
      const bx = (w - boxW) / 2;
      const by = h - boxH - h * 0.05;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 14) : ctx.rect(bx, by, boxW, boxH);
      ctx.fill();
      ctx.fillStyle = '#fff';
      lines.forEach((ln, i) => ctx.fillText(ln, w / 2, by + pad + i * lh + lh / 2));
    }
  }

  /** Record the whole story as a WebM using canvas + MediaRecorder. */
  async function renderStoryVideo() {
    await ensureCsrf();
    const scenes = state.story.scenes;
    if (!scenes.length) { toast('Generate scenes first.', true); return; }
    const ready = scenes.filter((s) => s.imageUrl && s.audioUrl);
    if (ready.length !== scenes.length) {
      toast('Wait for every scene to be ready before rendering.', true);
      return;
    }
    if (state.storyBusy) return;
    state.storyBusy = true;

    const dims = STORY_ASPECTS[state.story.aspect] || STORY_ASPECTS['16:9'];
    const canvas = document.createElement('canvas');
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext('2d');

    // Preload images.
    const imgs = [];
    for (const s of scenes) {
      const img = new Image();
      img.src = s.imageUrl;
      await new Promise((res) => { img.onload = res; img.onerror = res; });
      imgs.push(img);
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    const canvasStream = canvas.captureStream(30);
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    $('storyRenderBtn').disabled = true;
    $('storyRenderBtn').querySelector('.gen-label').textContent = 'Rendering…';
    setStatus('Rendering story video…');
    rec.start();

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      setStatus('Scene ' + (i + 1) + '/' + scenes.length + ': ' + s.text.slice(0, 40) + '…');
      await drawStoryScene(ctx, dims, imgs[i], s, ac, dest);
    }

    setStatus('Finalizing…');
    // Wire onstop before stop() so no chunk is missed and the promise always
    // settles even if stop() races the last ondataavailable event.
    const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
    rec.stop();
    const blob = await done;
    ac.close();

    $('storyRenderBtn').disabled = false;
    $('storyRenderBtn').querySelector('.gen-label').textContent = 'Render Video';
    setStatus(null);

    const url = URL.createObjectURL(blob);
    $('storyPreview').src = url;
    $('storyPreviewWrap').classList.remove('hidden');
    $('storyPreviewDl').href = url;
    $('storyPreviewDl').setAttribute('download', 'story-' + Date.now() + '.webm');
    $('storyPreviewWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Save to server history so it appears in Recent creations.
    try {
      const r = await fetch('api.php?action=story_upload&scenes=' + scenes.length +
        '&aspect=' + encodeURIComponent(state.story.aspect) +
        '&title=' + encodeURIComponent(scenes[0].text.slice(0, 80)) +
        '&csrf=' + encodeURIComponent(csrfToken), {
        method: 'POST', body: blob,
      });
      const d = await r.json();
      if (d.ok) { loadHistory(); toast('🎬 Story video saved!'); }
      else toast('🎬 Rendered! (history save: ' + d.error + ')');
    } catch (e) {
      toast('🎬 Rendered! (history upload failed — download above)');
    }
  }

  /** Play one scene's narration while animating its frame on the canvas. */
  function drawStoryScene(ctx, dims, img, scene, ac, dest) {
    return new Promise((resolve) => {
      const audio = new Audio(scene.audioUrl);
      audio.preload = 'auto';
      const src = ac.createMediaElementSource(audio);
      src.connect(dest);
      let duration = 6;
      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration) && audio.duration > 0) duration = audio.duration + 0.6;
      });
      const t0 = performance.now();
      const w = dims.w, h = dims.h;

      // Finish exactly once — via the frame loop (uses the real duration once
      // metadata loads), via the audio 'ended' event, or the last-resort guard.
      let settled = false;
      const finish = () => { if (settled) return; settled = true; resolve(); };

      function frame() {
        const p = Math.min(1, (performance.now() - t0) / (duration * 1000));
        drawStoryFrame(ctx, w, h, img, scene.text, p);
        if (p < 1) requestAnimationFrame(frame);
        else finish();
      }
      audio.addEventListener('ended', finish);
      audio.play().then(() => requestAnimationFrame(frame)).catch(() => { requestAnimationFrame(frame); });
      // Last-resort guard (hidden tabs throttle rAF): never hang the render,
      // and never truncate a scene — 2 minutes is far beyond any narration.
      setTimeout(finish, 120000);
    });
  }

  /** Toggle the story preview panel (re-render button). */
  function bindStoryPreview() {
    $('storyPreviewRe').addEventListener('click', () => {
      $('storyPreviewWrap').classList.add('hidden');
      renderStoryVideo();
    });
  }

  /* ---------------- lightbox ---------------- */
  function openLightbox(items, index) {
    if (!items.length) return;
    lbItems = items;
    lbIndex = index;
    renderLightbox();
    $('lightbox').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    $('lightbox').classList.add('hidden');
    document.body.style.overflow = '';
    if (lbZoomReset) lbZoomReset();
  }

  function renderLightbox() {
    const it = lbItems[lbIndex];
    if (!it) return;
    const mature = isGated(it.entry);
    const isVideo = it.entry.type === 'video';
    $('lbImg').classList.toggle('hidden', isVideo);
    $('lbVideo').classList.toggle('hidden', !isVideo);
    // Hide the zoom stage for videos so no empty bar shows above the player.
    const lbStageEl = $('lbImg').parentElement;
    if (lbStageEl && lbStageEl.classList.contains('lb-stage')) lbStageEl.classList.toggle('hidden', isVideo);
    if (isVideo) {
      $('lbVideo').src = it.url;
      $('lbVideo').play && $('lbVideo').play().catch(() => {});
    } else {
      $('lbImg').src = it.url;
      $('lbImg').classList.toggle('lb-blur', mature);
      $('lbMature').classList.toggle('hidden', !mature);
    }
    $('lbSeed').textContent = it.entry.seed;
    $('lbSize').textContent = it.entry.resolution;
    const styleName = (STYLES.find((s) => s[0] === it.entry.style) || [])[1] || it.entry.style;
    $('lbStyle').textContent = styleName;
    $('lbPrompt').textContent = it.entry.prompt;
    $('lbCount').textContent = (lbIndex + 1) + ' / ' + lbItems.length;
    $('lbDownload').href = 'api.php?action=download&id=' + encodeURIComponent(it.entry.id);
    $('lbDownload').setAttribute('download', '');
    $('lbPrev').disabled = lbIndex === 0;
    $('lbNext').disabled = lbIndex === lbItems.length - 1;
    if (lbZoomReset) lbZoomReset();
  }

  function lbStep(dir) {
    const next = lbIndex + dir;
    if (next < 0 || next >= lbItems.length) return;
    lbIndex = next;
    renderLightbox();
  }

  /* Lightbox image zoom & pan: click to zoom, drag to pan when zoomed,
     wheel to scale, double-click / double-tap to reset. */
  function bindLightboxZoom() {
    const img = $('lbImg');
    const stage = img ? img.parentElement : null;
    if (!stage || !stage.classList.contains('lb-stage')) return;

    let zoom = 1, tx = 0, ty = 0;
    let drag = null, suppressClick = false, lastTap = 0;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const limits = () => ({
      x: Math.max(0, ((zoom - 1) * img.offsetWidth) / 2),
      y: Math.max(0, ((zoom - 1) * img.offsetHeight) / 2),
    });
    const apply = () => {
      img.style.transform = zoom > 1 ? 'translate(' + tx + 'px, ' + ty + 'px) scale(' + zoom + ')' : '';
      img.classList.toggle('zoomed', zoom > 1);
    };
    const reset = () => {
      zoom = 1; tx = 0; ty = 0; drag = null; suppressClick = false;
      img.classList.remove('dragging');
      apply();
    };

    lbZoomReset = reset;

    img.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      if (zoom > 1) reset();
      else { zoom = 2.5; tx = 0; ty = 0; apply(); }
    });
    img.addEventListener('dblclick', (e) => { e.preventDefault(); reset(); });

    img.addEventListener('mousedown', (e) => {
      if (zoom <= 1) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, ox: tx, oy: ty, moved: false };
      img.classList.add('dragging');
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const lim = limits();
      tx = clamp(drag.ox + dx, -lim.x, lim.x);
      ty = clamp(drag.oy + dy, -lim.y, lim.y);
      apply();
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      suppressClick = drag.moved;
      drag = null;
      img.classList.remove('dragging');
    });

    // Wheel: scale around the image center.
    stage.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      zoom = clamp(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 5);
      if (zoom <= 1.01) { zoom = 1; tx = 0; ty = 0; }
      const lim = limits();
      tx = clamp(tx, -lim.x, lim.x);
      ty = clamp(ty, -lim.y, lim.y);
      apply();
    }, { passive: false });

    // Touch: pan with one finger when zoomed, double-tap to toggle zoom.
    img.addEventListener('touchstart', (e) => {
      if (zoom <= 1 || e.touches.length !== 1) return;
      const t = e.touches[0];
      drag = { x: t.clientX, y: t.clientY, ox: tx, oy: ty, moved: false };
    }, { passive: true });
    img.addEventListener('touchmove', (e) => {
      if (!drag || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      const lim = limits();
      tx = clamp(drag.ox + (t.clientX - drag.x), -lim.x, lim.x);
      ty = clamp(drag.oy + (t.clientY - drag.y), -lim.y, lim.y);
      apply();
    }, { passive: false });
    img.addEventListener('touchend', () => {
      drag = null;
      const now = Date.now();
      if (now - lastTap < 300) {
        if (zoom > 1) reset(); else { zoom = 2.5; tx = 0; ty = 0; apply(); }
        lastTap = 0;
      } else {
        lastTap = now;
      }
    });
  }

  /* ---------------- history ---------------- */
  async function loadHistory() {
    try {
      const r = await fetch('api.php?action=history');
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      state.history = d.items || [];
      applyHistoryFilter();
    } catch (e) {
      toast('Could not load history: ' + friendlyError(e), true);
    }
  }

  /** Re-render history, keeping the current search filter (if any). */
  function applyHistoryFilter() {
    const input = $('historySearch');
    const q = (input && input.value.trim().toLowerCase()) || '';
    const filtered = q
      ? state.history.filter((h) => (h.prompt || '').toLowerCase().includes(q))
      : state.history;
    renderHistory(filtered);
    // renderHistory fills the pill from the *filtered* set; when a filter is
    // active, say so explicitly so the total isn't mistaken for the shown set.
    if (q) {
      $('historyCount').textContent = 'showing ' + filtered.length + ' of ' + state.history.length;
    }
  }

  function renderHistory(items) {
    const grid = $('historyGrid');
    const empty = $('historyEmpty');
    grid.innerHTML = '';
    const vids = items.filter((it) => it.type === 'video').length;
    const imgs = items.length - vids;
    const label = items.length === 1
      ? (vids === 1 ? '1 video' : '1 image')
      : (items.length + ' items');
    $('historyCount').textContent = label + (imgs > 0 && vids > 0 ? ' · ' + imgs + ' img / ' + vids + ' vid' : '');
    $('clearAllBtn').disabled = state.history.length === 0;
    // Show the empty state only when there is genuinely no history at all —
    // a search with no matches gets its own message instead.
    empty.classList.toggle('hidden', state.history.length > 0);
    empty.querySelector('p').textContent = state.history.length > 0
      ? 'No creations match your search.'
      : 'Nothing forged yet. Your saved images will collect here.';

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';

      const img = mediaEl(item, item.url);

      const mature = isGated(item) && item.type !== 'video';
      if (mature) card.classList.add('card-mature');

      const overlay = document.createElement('div');
      overlay.className = 'card-overlay';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'card-del';
      del.title = 'Delete';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });

      const cap = document.createElement('div');
      cap.className = 'card-cap';
      cap.textContent = item.prompt;

      overlay.appendChild(del);
      overlay.appendChild(cap);
      card.appendChild(img);
      card.appendChild(overlay);

      card.addEventListener('click', async () => {
        if (isGated(item)) {
          const ok = await askMature();
          if (!ok) return;
        }
        const idx = state.history.findIndex((h) => h.id === item.id);
        openLightbox(state.history.map((h) => ({ entry: h, url: h.url })), idx);
      });
      grid.appendChild(card);
    });
  }

  /* ---------------- confirm dialog ---------------- */
  /** Ask a yes/no question with the themed modal instead of native confirm(). */
  function askConfirm({ title, message, yesLabel = 'Delete' }) {
    // If a dialog is already open (safety guard), chain onto it so no caller
    // is left awaiting forever.
    if (confirmResolver) {
      return new Promise((resolve) => {
        const prev = confirmResolver;
        confirmResolver = (ok) => { prev(ok); resolve(ok); };
      });
    }
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    $('confirmYes').textContent = yesLabel;
    return new Promise((resolve) => {
      confirmResolver = resolve;
      $('confirmModal').classList.remove('hidden');
    });
  }

  function resolveConfirm(ok) {
    if (confirmResolver) {
      const r = confirmResolver;
      confirmResolver = null;
      $('confirmModal').classList.add('hidden');
      r(ok);
    }
  }

  /* ---------------- delete ---------------- */
  async function deleteItem(id) {
    const ok = await askConfirm({
      title: 'Delete this image?',
      message: 'This removes the image from history and deletes its file from disk. This cannot be undone.',
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append('action', 'delete');
    csrfAppend(fd);
    fd.append('id', id);
    try {
      const r = await fetch('api.php', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);

      // Remove from the current batch grid if it's there.
      const bi = state.batch.findIndex((it) => it && it.entry.id === id);
      if (bi >= 0) {
        state.batch[bi] = null;
        const grid = $('resultGrid');
        if (grid.children[bi]) {
          grid.children[bi].remove();
        }
        updateDlAll();
        if (state.batch.every((it) => it === null)) {
          showEmpty();
        }
      }
      closeLightbox();
      toast('Image deleted.');
      loadHistory();
    } catch (e) {
      toast('Delete failed: ' + friendlyError(e), true);
    }
  }

  /* ---------------- clear all history ---------------- */
  async function clearAllHistory() {
    const n = state.history.length;
    if (n === 0) {
      toast('History is already empty.');
      return;
    }
    const ok = await askConfirm({
      title: 'Clear all history?',
      message: 'Delete ALL ' + n + ' images from history? The image files will be permanently removed from disk. This cannot be undone.',
      yesLabel: 'Clear all',
    });
    if (!ok) return;
    const btn = $('clearAllBtn');
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    try {
      const fd = new FormData();
      fd.append('action', 'clear_all');
      csrfAppend(fd);
      const r = await fetch('api.php', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Could not clear history.');
      // Current batch files are gone from disk too — reset the grid.
      state.batch = [];
      closeLightbox();
      showEmpty();
      loadHistory();
      toast('🗑 History cleared — ' + (d.removed || 0) + ' files removed.');
    } catch (e) {
      toast('Clear failed: ' + friendlyError(e), true);
    } finally {
      btn.disabled = state.history.length > 0;
      btn.textContent = '🗑 Clear all';
    }
  }

  /* ---------------- prompt history (localStorage) ---------------- */
  const PH_KEY = 'pf_prompt_history';
  const PH_MAX = 12;
  let promptHistory = [];
  let phDropdownOpen = false;

  function loadPromptHistory() {
    try {
      promptHistory = JSON.parse(localStorage.getItem(PH_KEY) || '[]');
      if (!Array.isArray(promptHistory)) promptHistory = [];
    } catch (e) { promptHistory = []; }
  }

  function savePromptHistoryEntry(text) {
    if (!text || text.trim().length < 4) return;
    promptHistory = promptHistory.filter((h) => h !== text);
    promptHistory.unshift(text);
    if (promptHistory.length > PH_MAX) promptHistory.length = PH_MAX;
    try { localStorage.setItem(PH_KEY, JSON.stringify(promptHistory)); } catch (e) {}
  }

  function removePromptHistoryEntry(text) {
    promptHistory = promptHistory.filter((h) => h !== text);
    try { localStorage.setItem(PH_KEY, JSON.stringify(promptHistory)); } catch (e) {}
  }

  function renderPromptHistory() {
    const wrap = $('promptHistoryWrap');
    if (!wrap) return;
    const list = wrap.querySelector('.prompt-history-list');
    if (!list) return;
    list.innerHTML = '';
    if (promptHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'prompt-history-empty';
      empty.textContent = 'No prompts yet — forge one and it will appear here.';
      list.appendChild(empty);
    } else {
      promptHistory.forEach((text) => {
        const item = document.createElement('div');
        item.className = 'prompt-history-item';
        const txt = document.createElement('span');
        txt.className = 'ph-text';
        txt.textContent = text;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ph-delete';
        del.title = 'Remove';
        del.textContent = '✕';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          removePromptHistoryEntry(text);
          renderPromptHistory();
        });
        item.appendChild(txt);
        item.appendChild(del);
        item.addEventListener('click', () => {
          $('prompt').value = text;
          $('promptCount').textContent = text.length + ' / 2000';
          saveSession();
          closePhDropdown();
          toast('💡 Prompt loaded — hit ⚡ Forge!');
        });
        list.appendChild(item);
      });
    }
  }

  function togglePhDropdown() {
    const wrap = $('promptHistoryWrap');
    const list = wrap ? wrap.querySelector('.prompt-history-list') : null;
    if (!list) return;
    phDropdownOpen = !phDropdownOpen;
    list.classList.toggle('hidden', !phDropdownOpen);
    if (phDropdownOpen) renderPromptHistory();
  }

  function closePhDropdown() {
    phDropdownOpen = false;
    const wrap = $('promptHistoryWrap');
    const list = wrap ? wrap.querySelector('.prompt-history-list') : null;
    if (list) list.classList.add('hidden');
  }

  /* ---------------- negative prompt presets ---------------- */
  /** Mark a preset chip active iff every one of its tokens is in the input. */
  function syncNegChips() {
    const cur = ($('negative').value || '').toLowerCase();
    document.querySelectorAll('.neg-chip').forEach((chip) => {
      const tokens = (chip.dataset.neg || '').split(/,\s*/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      const all = tokens.length > 0 && tokens.every((t) => cur.includes(t));
      chip.classList.toggle('active', all);
    });
  }

  function bindNegPresets() {
    document.querySelectorAll('.neg-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const neg = chip.dataset.neg || '';
        const cur = $('negative').value.trim();
        if (chip.classList.contains('active')) {
          // Toggle off: remove this preset's tokens from the input.
          const tokens = neg.split(/,\s*/).map((t) => t.trim().toLowerCase());
          const existing = cur.split(/,\s*/).map((t) => t.trim()).filter((t) => t);
          const remaining = existing.filter((t) => !tokens.includes(t.toLowerCase()));
          $('negative').value = remaining.join(', ');
        } else {
          // Toggle on: merge tokens into the input.
          const existing = cur.split(/,\s*/).map((t) => t.trim()).filter((t) => t);
          const newTokens = neg.split(/,\s*/).map((t) => t.trim()).filter((t) => t && !existing.includes(t));
          $('negative').value = [...existing, ...newTokens].join(', ');
        }
        syncNegChips();
        saveSession();
      });
    });
    // Keep chips honest when the field is edited or restored from storage.
    $('negative').addEventListener('input', syncNegChips);
    syncNegChips();
  }

  /* ---------------- gallery search/filter ---------------- */
  function bindHistorySearch() {
    const input = $('historySearch');
    if (!input) return;
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => applyHistoryFilter(), 200);
    });
    // Escape clears the search.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        applyHistoryFilter();
      }
    });
  }

  /* ---------------- prompt enhancer (free ai-text-plugin) ---------------- */

  /**
   * Expand the current prompt into a detailed, vivid version using the free
   * Perchance text-generation API (the same engine behind their ai-text-plugin).
   * On success the prompt box is replaced with the enhanced text.
   */
  async function enhancePrompt() {
    const btn = $('enhanceBtn');
    if (!btn || btn.classList.contains('working')) return;
    if (state.busy) {
      toast('Wait for the current batch to finish, then enhance.', true);
      return;
    }
    const prompt = $('prompt').value.trim();
    if (!prompt) {
      toast('Type a prompt first — Enhance will expand it into a vivid, detailed version.', true);
      $('prompt').focus();
      return;
    }
    btn.classList.add('working');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enhancing…';
    setStatus('Enhancing your prompt with AI… (free, takes ~10–40s)');
    try {
      const fd = new FormData();
      fd.append('action', 'enhance');
      csrfAppend(fd);
      fd.append('prompt', prompt);
      const r = await fetch('api.php', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Enhancement failed.');
      let enhanced = (d.text || '').trim();
      if (!enhanced) throw new Error('The AI returned an empty prompt — try again.');
      if (enhanced.length > 2000) enhanced = enhanced.slice(0, 2000).trim();
      $('prompt').value = enhanced;
      $('promptCount').textContent = enhanced.length + ' / 2000';
      saveSession();
      toast('✨ Prompt enhanced! Review it, tweak if you like, then hit Forge.');
    } catch (e) {
      toast('Enhance failed: ' + friendlyError(e), true);
    } finally {
      btn.classList.remove('working');
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Enhance';
      setStatus(null);
    }
  }

  /* ---------------- misc actions ---------------- */
  function triggerDownload(entry) {
    const a = document.createElement('a');
    a.href = 'api.php?action=download&id=' + encodeURIComponent(entry.id);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Roll a fresh random seed into the Seed field (used by 🎲 and the S key). */
  function rollSeed() {
    const adv = $('advancedPanel');
    if (adv) adv.open = true; // reveal the value if the panel is collapsed
    $('seed').value = Math.floor(Math.random() * 1000000000);
    saveSession();
    toast('🎲 Random seed: ' + $('seed').value);
  }

  /** Sample-prompt chips in the empty state — one click fills the prompt. */
  function bindPromptChips() {
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const p = chip.dataset.prompt || '';
        $('prompt').value = p;
        $('promptCount').textContent = p.length + ' / 2000';
        saveSession();
        toast('💡 Prompt loaded — hit ⚡ Forge!');
        $('prompt').focus();
      });
    });
  }

  function bindMisc() {
    $('enhanceBtn').addEventListener('click', enhancePrompt);
    $('seedDice').addEventListener('click', rollSeed);
    $('prompt').addEventListener('input', (e) => {
      $('promptCount').textContent = e.target.value.length + ' / 2000';
      saveSession();
    });
    $('negative').addEventListener('input', saveSession);
    $('seed').addEventListener('input', saveSession);

    bindSegmented('resSeg', (key) => {
      state.resolution = key;
      syncCustomResRow();
      if (key === 'custom') toast('Custom: set width × height below — the free engine caps at 768px and snaps to 64px steps.');
      saveSession();
    });
    // Custom W/H inputs: snap to 64px steps on change; remember the values.
    ['resW', 'resH'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        el.value = snapDim(el.value);
        saveSession();
      });
      el.addEventListener('input', () => saveSession());
    });
    bindSegmented('countSeg', (key) => {
      state.count = parseInt(key, 10) || 4;
      saveSession();
      if (state.count >= 16) {
        toast('Heads up: ' + state.count + ' images at ~10–30s each is a few minutes — let it run!');
      }
    });

    // Lightbox controls
    $('lightbox').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeLightbox();
    });
    $('lbPrev').addEventListener('click', () => lbStep(-1));
    $('lbNext').addEventListener('click', () => lbStep(1));

    $('lbReuse').addEventListener('click', () => {
      const it = lbItems[lbIndex];
      if (!it) return;
      $('seed').value = it.entry.seed;
      $('prompt').value = it.entry.prompt_orig || it.entry.prompt;
      closeLightbox();
      toast('Seed + prompt loaded. Adjust and forge again!');
    });
    $('lbCopy').addEventListener('click', () => {
      const it = lbItems[lbIndex];
      if (!it) return;
      navigator.clipboard.writeText(it.entry.prompt)
        .then(() => toast('Prompt copied to clipboard.'))
        .catch(() => toast('Could not copy.', true));
    });
    $('lbDelete').addEventListener('click', () => {
      const it = lbItems[lbIndex];
      if (it) deleteItem(it.entry.id);
    });
    $('lbReveal').addEventListener('click', () => {
      askMature().then((ok) => { if (ok) renderLightbox(); });
    });

    // Mode toggle (images / video / story / 3d)
    $('modeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn || btn.dataset.mode === state.mode) return;
      state.mode = btn.dataset.mode;
      $('modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      const c = document.querySelector('.controls');
      c.classList.toggle('video-mode', state.mode === 'video');
      c.classList.toggle('story-mode', state.mode === 'story');
      c.classList.toggle('3d-mode', state.mode === '3d');
      $('genBtn').classList.toggle('hidden', state.mode === 'story');
      $('genBtn').querySelector('.gen-label').textContent = genLabel();
      // Show/hide result sub-panels.
      $('resultGrid').classList.toggle('hidden', state.mode === 'story' || state.mode === '3d');
      $('storyScenes').classList.toggle('hidden', state.mode !== 'story');
      $('d3dStage').classList.toggle('hidden', state.mode !== '3d');
      if (state.mode === 'story') {
        $('resultEmpty').classList.add('hidden');
        $('storyScenes').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (state.mode === '3d') {
        $('resultEmpty').classList.add('hidden');
        $('storyPreviewWrap').classList.add('hidden');
      } else {
        $('resultEmpty').classList.remove('hidden');
        $('storyPreviewWrap').classList.add('hidden');
      }
      // Keep the 3D preview loop running only while its tab is visible.
      if (state.mode === '3d') startD3DLoop();
      else D3D.loopOn = false;
      setStatus(null);
      updateRefUi();
      if (state.mode === 'video' && state.videoEngine === 'replicate' && !state.videoKey) {
        toast('Video mode: the Replicate engine needs an API key — or switch to “Free · no key”.');
      }
    });

    // Story mode controls
    $('storyGenBtn').addEventListener('click', generateStory);
    $('storyRenderBtn').addEventListener('click', renderStoryVideo);
    $('storyText').addEventListener('input', () => {
      // Enable Generate Scenes whenever there is text to split.
      $('storyGenBtn').disabled = $('storyText').value.trim() === '';
      saveSession();
    });
    $('storyVoice').addEventListener('change', () => { state.story.voice = $('storyVoice').value; saveSession(); });
    $('storyRate').addEventListener('change', saveSession);
    $('splitRule').addEventListener('change', saveSession);
    $('storyCaptions').addEventListener('change', () => { state.story.captions = $('storyCaptions').checked; saveSession(); });
    bindSegmented('aspectSeg', (key) => { state.story.aspect = key; saveSession(); });
    bindStoryPreview();

    // Save the free Pollinations key for the free video engine
    $('polliKeySave').addEventListener('click', async () => {
      const key = $('polliKey').value.trim();
      if (!key) {
        toast('Paste your Pollinations key first (starts with pk_ or sk_).', true);
        return;
      }
      const btn = $('polliKeySave');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const fd = new FormData();
        fd.append('action', 'pollikey');
        csrfAppend(fd);
        fd.append('key', key);
        const r = await fetch('api.php', { method: 'POST', body: fd });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error);
        state.polliKey = true;
        $('polliKey').value = '';
        toast('✅ Pollinations key saved! Free video engine unlocked.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });

    // Save the Replicate API key for video mode
    $('videoKeySave').addEventListener('click', async () => {
      const key = $('videoKey').value.trim();
      if (!key) {
        toast('Paste your Replicate API key first (starts with r8_).', true);
        return;
      }
      const btn = $('videoKeySave');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const fd = new FormData();
        fd.append('action', 'videokey');
        csrfAppend(fd);
        fd.append('key', key);
        const r = await fetch('api.php', { method: 'POST', body: fd });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error);
        state.videoKey = true;
        $('videoKey').value = '';
        toast('✅ Video API key saved!');
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });

    // Download-all batch zip
    $('dlAllBtn').addEventListener('click', downloadAll);

    // Clear all history
    $('clearAllBtn').addEventListener('click', clearAllHistory);

    // Mature-content confirm modal
    $('matureYes').addEventListener('click', () => confirmMature());
    $('matureNo').addEventListener('click', () => resolveMature(false));
    $('matureModal').addEventListener('click', (e) => {
      if (e.target.closest('[data-mclose]')) resolveMature(false);
    });

    // Generic confirm dialog (delete / clear all)
    $('confirmYes').addEventListener('click', () => resolveConfirm(true));
    $('confirmNo').addEventListener('click', () => resolveConfirm(false));
    $('confirmModal').addEventListener('click', (e) => {
      if (e.target.closest('[data-cclose]')) resolveConfirm(false);
    });

    // Master mature-content toggle.
    // The checkbox itself is visually hidden (opacity:0, 0x0), so clicking the
    // visible switch slider must flip it manually. Scope to the mature toggle's
    // own .switch — there are multiple switches on the page (e.g. the story
    // Captions switch appears earlier), and document.querySelector('.switch')
    // used to grab the FIRST one, so this toggle never responded.
    const toggle = $('matureToggle');
    toggle.checked = state.allowMature;
    const matureSwitch = toggle.closest('.switch');
    if (matureSwitch) {
      matureSwitch.addEventListener('click', (e) => {
        if (e.target === toggle) return; // direct input click — native behaviour
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event('change'));
      });
    }
    toggle.addEventListener('change', () => {
      state.allowMature = toggle.checked;
      localStorage.setItem('pf_mature', toggle.checked ? '1' : '0');
      refreshBatch();
      loadHistory();
      renderLightbox();
      toast(toggle.checked ? 'Mature content will now be shown without warning.' : 'Mature content is blurred again.', !toggle.checked);
    });

    // Advanced panel: remember whether it was left open.
    const advPanel = $('advancedPanel');
    if (advPanel) {
      advPanel.open = localStorage.getItem('pf_advanced') === '1';
      advPanel.addEventListener('toggle', () => {
        localStorage.setItem('pf_advanced', advPanel.open ? '1' : '0');
      });
    }

    document.addEventListener('keydown', (e) => {
      const lbOpen = !$('lightbox').classList.contains('hidden');
      const mmOpen = !$('matureModal').classList.contains('hidden');
      const cmOpen = !$('confirmModal').classList.contains('hidden');
      if (e.key === 'Escape') {
        if (mmOpen) resolveMature(false);
        if (cmOpen) resolveConfirm(false);
        closeLightbox();
        closePhDropdown();
      }
      if (lbOpen && e.key === 'ArrowLeft') lbStep(-1);
      if (lbOpen && e.key === 'ArrowRight') lbStep(1);
      if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) generate();
      // S = random seed (skip while typing or a modal is open).
      const tag = e.target && e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
      if (!typing && !mmOpen && !cmOpen && state.mode !== 'story' && state.mode !== '3d' && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        rollSeed();
      }
    });

    // Keep the grid capped at ~2 rows (and the 3D stage sized) on resize.
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { capGridRows(); resizeD3D(); }, 150);
    });
  }

  /* ============================================================
     3D mode — photo → 3D depth animation (browser WebGL)
     ============================================================ */

  /** Live state for the 3D tab (independent from state.ref). */
  const D3D = {
    url: '',           // data URL of the source photo
    img: null,         // loaded Image element
    depthCanvas: null, // depth-map canvas for the current settings
    depthUrl: '',      // PNG data URL of the depth map (used by the embed export)
    depthMode: 'auto',
    strength: 45,
    smooth: 60,
    motion: 'drift',
    speed: 50,
    busy: false,
    THREE: null,       // cached Three.js global (lazy CDN load)
    engine: null,      // live preview: { renderer, scene, cam, mesh, mat, geo, texColor, texDepth, start }
    loopOn: false,
    pointer: { x: 0, y: 0 },
  };

  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js';

  /** Inject Three.js once — lazily, only when the 3D tab is actually used. */
  function loadThree() {
    if (D3D.THREE) return Promise.resolve(D3D.THREE);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_CDN;
      s.onload = () => {
        if (window.THREE) { D3D.THREE = window.THREE; resolve(window.THREE); }
        else reject(new Error('Three.js loaded but its global is missing — try a hard refresh.'));
      };
      s.onerror = () => reject(new Error('Could not load Three.js from the CDN — 3D mode needs internet access.'));
      document.head.appendChild(s);
    });
  }

  /* Vertex shader: displace the plane by depth, tilt it, fake-light it. */
  const D3D_VERT = [
    'uniform sampler2D uDepth;',
    'uniform float uAmp;',
    'uniform float uTime;',
    'uniform float uWave;',
    'uniform float uTiltX;',
    'uniform float uTiltY;',
    'varying vec2 vUv;',
    'varying float vShade;',
    'void main() {',
    '  vUv = uv;',
    '  float d = texture2D(uDepth, uv).r;',
    '  float wave = uWave * (sin(uv.x * 26.0 + uTime * 2.4) * sin(uv.y * 18.0 - uTime * 1.7));',
    '  vec3 pos = position;',
    '  pos.z = (d - 0.5) * uAmp + wave;',
    '  float cy = cos(uTiltY), sy = sin(uTiltY);',
    '  float cx = cos(uTiltX), sx = sin(uTiltX);',
    '  pos.xz = vec2(pos.x * cy - pos.z * sy, pos.x * sy + pos.z * cy);',
    '  pos.yz = vec2(pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);',
    '  vShade = 1.0 + (d - 0.5) * 0.55 + wave * 1.4;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
    '}',
  ].join('\n');

  const D3D_FRAG = [
    'uniform sampler2D uTex;',
    'varying vec2 vUv;',
    'varying float vShade;',
    'void main() {',
    '  vec4 col = texture2D(uTex, vUv);',
    '  gl_FragColor = vec4(col.rgb * vShade, 1.0);',
    '}',
  ].join('\n');

  /** Current effect parameters derived from the sliders. */
  function d3dParams() {
    const s = D3D.speed / 100;
    const amp = (D3D.strength / 100) * 1.35;
    const wave = D3D.motion === 'waves' ? 0.03 + s * 0.05
      : D3D.motion === 'none' ? 0
        : 0.012 * s;
    return { amp, wave, s };
  }

  /** Cheap two-pass box blur on a grayscale canvas (works everywhere). */
  function boxBlurGray(canvas, radius) {
    const ctx = canvas.getContext('2d');
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = id.data, w = canvas.width, h = canvas.height;
    const src = new Float32Array(w * h), dst = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = d[(y * w + x) * 4];
    const pass = (inp, out) => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0, n = 0;
          for (let yy = -radius; yy <= radius; yy++) {
            const ny = y + yy; if (ny < 0 || ny >= h) continue;
            for (let xx = -radius; xx <= radius; xx++) {
              const nx = x + xx; if (nx < 0 || nx >= w) continue;
              sum += inp[ny * w + nx]; n++;
            }
          }
          out[y * w + x] = sum / n;
        }
      }
    };
    pass(src, dst); pass(dst, src);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4] = src[y * w + x];
    ctx.putImageData(id, 0, 0);
    return canvas;
  }

  /**
   * Build a grayscale depth map from the photo. The map stays small (≤192px)
   * — it only drives vertex displacement, so it's fast and memory-light.
   */
  function buildDepthMap(img, mode, smooth) {
    const MAX = 192;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(8, Math.round(img.naturalWidth * scale));
    const h = Math.max(8, Math.round(img.naturalHeight * scale));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const lum = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;
        const dist = Math.min(1, Math.sqrt(((x - cx) / maxR) ** 2 + ((y - cy) / maxR) ** 2));
        let depth = 0.5;
        if (mode === 'luminance') depth = lum;
        else if (mode === 'radial') depth = 0.5 + (1 - dist) * 0.45 + lum * 0.1;
        else if (mode === 'vertical') depth = 1 - (y / (h - 1)) * 0.7 + lum * 0.3;
        else if (mode === 'flat') depth = 0.5;
        else depth = lum * 0.72 + (1 - dist) * 0.28; // auto
        const v = Math.max(0, Math.min(255, Math.round(depth * 255)));
        d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return boxBlurGray(c, 1 + Math.round(smooth * 0.07));
  }

  function d3dCamera(aspect, THREE) {
    return new THREE.OrthographicCamera(-6 * aspect, 6 * aspect, 6, -6, 0.1, 50);
  }

  /** Create the live preview engine and start animating. */
  function initD3DEngine(THREE) {
    disposeD3DEngine();
    const img = D3D.img;
    const aspect = img.naturalWidth / img.naturalHeight;
    const wrap = $('d3dCanvasWrap');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d1a);

    const cImg = makeCanvas(img.naturalWidth, img.naturalHeight);
    cImg.getContext('2d').drawImage(img, 0, 0);
    const texColor = new THREE.CanvasTexture(cImg);
    if (texColor.colorSpace !== undefined) texColor.colorSpace = THREE.SRGBColorSpace;

    const dc = buildDepthMap(img, D3D.depthMode, D3D.smooth);
    D3D.depthCanvas = dc;
    D3D.depthUrl = dc.toDataURL('image/png');
    const texDepth = new THREE.CanvasTexture(dc);

    const geo = new THREE.PlaneGeometry(9 * aspect, 9, 128, 128);
    const p = d3dParams();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: texColor },
        uDepth: { value: texDepth },
        uAmp: { value: p.amp },
        uTime: { value: 0 },
        uWave: { value: p.wave },
        uTiltX: { value: 0 },
        uTiltY: { value: 0 },
      },
      vertexShader: D3D_VERT,
      fragmentShader: D3D_FRAG,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const cam = d3dCamera(aspect, THREE);
    cam.position.z = 10;

    D3D.engine = { renderer, scene, cam, mesh, mat, geo, texColor, texDepth, start: performance.now() };
    bindD3DPointer(wrap);
    resizeD3D();
    startD3DLoop();
  }

  /** Match the preview renderer (and the wrap's height) to the available width,
      capped so very tall images don't push the stage off screen. */
  function resizeD3D() {
    if (!D3D.engine || !D3D.img) return;
    const wrap = $('d3dCanvasWrap');
    const w = wrap.clientWidth || 600;
    const aspect = D3D.img.naturalWidth / D3D.img.naturalHeight;
    const h = Math.min(Math.round(w / aspect), 560);
    wrap.style.height = h + 'px';
    D3D.engine.renderer.setSize(w, h, false);
  }

  function bindD3DPointer(wrap) {
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      D3D.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      D3D.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    });
    wrap.addEventListener('pointerleave', () => { D3D.pointer.x = 0; D3D.pointer.y = 0; });
  }

  function startD3DLoop() {
    if (!D3D.engine || D3D.loopOn) return;
    D3D.loopOn = true;
    const { renderer, scene, cam, mat } = D3D.engine;
    const t0 = performance.now();
    const step = () => {
      if (!D3D.loopOn) return;
      const t = (performance.now() - t0) / 1000;
      const p = d3dParams();
      const s = p.s;
      let ix = 0, iy = 0, zoom = 1;
      if (D3D.motion === 'drift') {
        ix = Math.sin(t * 0.55) * 0.55 * (0.4 + s * 0.6);
        iy = Math.cos(t * 0.4) * 0.35 * (0.4 + s * 0.6);
      } else if (D3D.motion === 'kenburns') {
        const k = 0.5 + 0.5 * Math.sin(t * 0.18);
        zoom = 1 + k * 0.16 * (0.3 + s * 0.7);
        ix = Math.sin(t * 0.22) * 0.3;
        iy = Math.cos(t * 0.16) * 0.2;
      }
      const mx = D3D.pointer.x, my = D3D.pointer.y;
      cam.position.x = ix + mx * (0.55 + s * 0.45);
      cam.position.y = iy + my * (0.45 + s * 0.35);
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
      mat.uniforms.uTiltX.value = my * 0.06 + iy * 0.02;
      mat.uniforms.uTiltY.value = mx * 0.08 + ix * 0.03;
      mat.uniforms.uTime.value = t;
      renderer.render(scene, cam);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function disposeD3DEngine() {
    D3D.loopOn = false;
    if (D3D.engine) {
      const e = D3D.engine;
      e.mat.dispose();
      e.geo.dispose();
      e.texColor.dispose();
      e.texDepth.dispose();
      e.renderer.dispose();
      if (e.renderer.domElement && e.renderer.domElement.parentNode) {
        e.renderer.domElement.parentNode.removeChild(e.renderer.domElement);
      }
      D3D.engine = null;
    }
  }

  /** Rebuild only the depth texture (depth mode / smoothness changed). */
  function rebuildD3DDepth() {
    if (!D3D.engine || !D3D.img) return;
    const e = D3D.engine;
    const dc = buildDepthMap(D3D.img, D3D.depthMode, D3D.smooth);
    D3D.depthCanvas = dc;
    D3D.depthUrl = dc.toDataURL('image/png');
    e.texDepth.dispose();
    e.texDepth = new D3D.THREE.CanvasTexture(dc);
    e.mat.uniforms.uDepth.value = e.texDepth;
    applyD3DParams();
  }

  function applyD3DParams() {
    if (!D3D.engine) return;
    const p = d3dParams();
    D3D.engine.mat.uniforms.uAmp.value = p.amp;
    D3D.engine.mat.uniforms.uWave.value = p.wave;
  }

  /* Monotonic token so a slower image drop can't overwrite a newer one. */
  let d3dLoadSeq = 0;

  async function setD3DImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('Please choose an image file.', true);
      return;
    }
    const seq = ++d3dLoadSeq;
    try {
      const dataUrl = await downscaleRefImage(file, 1400, 0.88);
      if (seq !== d3dLoadSeq) return; // superseded by a newer drop
      D3D.url = dataUrl;
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Could not read that image.'));
        img.src = dataUrl;
      });
      if (seq !== d3dLoadSeq) return; // superseded while decoding
      D3D.img = img;
      $('d3dPreview').src = dataUrl;
      $('d3dDrop').classList.add('hidden');
      $('d3dPreviewWrap').classList.remove('hidden');
      $('d3dEmpty').classList.add('hidden');
      $('d3dView').classList.remove('hidden');
      $('d3dResult').classList.add('hidden');
      $('d3dCanvasWrap').classList.remove('hidden');
      $('d3dStage').classList.remove('hidden');
      setStatus(null);
      const THREE = await loadThree();
      if (seq !== d3dLoadSeq) return; // superseded while the CDN loaded
      initD3DEngine(THREE);
      saveSession();
      toast('🧊 Photo loaded — move your mouse over the preview!');
    } catch (e) {
      toast(friendlyError(e), true);
    }
  }

  function clearD3DImage() {
    d3dLoadSeq++; // invalidate any in-flight image load
    D3D.url = ''; D3D.img = null; D3D.depthCanvas = null; D3D.depthUrl = '';
    $('d3dFile').value = '';
    $('d3dPreview').src = '';
    $('d3dDrop').classList.remove('hidden');
    $('d3dPreviewWrap').classList.add('hidden');
    $('d3dView').classList.add('hidden');
    $('d3dEmpty').classList.remove('hidden');
    $('d3dResult').classList.add('hidden');
    $('d3dResultVideo').src = '';
    disposeD3DEngine();
  }

  /** Record an 8s looping WebM of the 3D scene (scripted camera, no mouse). */
  async function render3DVideo() {
    await ensureCsrf();
    if (!D3D.img) { toast('Drop a photo on the left first.', true); return; }
    if (D3D.busy) return;
    const THREE = await loadThree().catch((e) => { toast(e.message, true); return null; });
    if (!THREE) return;
    if (!D3D.img) { toast('Drop a photo on the left first.', true); return; } // cleared while loading
    D3D.busy = true;
    const btn = $('d3dRenderBtn');
    btn.disabled = true;
    btn.querySelector('.gen-label').textContent = 'Rendering…';
    setStatus('Rendering 8s 3D animation… (takes ~10–20s)');
    $('d3dResult').classList.add('hidden');
    $('d3dResultVideo').src = '';
    $('d3dCanvasWrap').classList.remove('hidden');
    try {
      const aspect = D3D.img.naturalWidth / D3D.img.naturalHeight;
      let W = 1280, H = Math.round(1280 / aspect);
      if (H > 1280) { H = 1280; W = Math.round(1280 * aspect); }
      H = Math.max(480, H);
      if (H === 480 && aspect > 1) W = Math.round(480 * aspect);

      const cImg = makeCanvas(D3D.img.naturalWidth, D3D.img.naturalHeight);
      cImg.getContext('2d').drawImage(D3D.img, 0, 0);
      const texColor = new THREE.CanvasTexture(cImg);
      if (texColor.colorSpace !== undefined) texColor.colorSpace = THREE.SRGBColorSpace;
      const texDepth = new THREE.CanvasTexture(buildDepthMap(D3D.img, D3D.depthMode, D3D.smooth));
      const geo = new THREE.PlaneGeometry(9 * (W / H), 9, 180, 180);
      const p = d3dParams();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: texColor },
          uDepth: { value: texDepth },
          uAmp: { value: p.amp },
          uTime: { value: 0 },
          uWave: { value: p.wave },
          uTiltX: { value: 0 },
          uTiltY: { value: 0 },
        },
        vertexShader: D3D_VERT,
        fragmentShader: D3D_FRAG,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0d1a);
      scene.add(mesh);
      const cam = d3dCamera(W / H, THREE);
      cam.position.z = 10;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(1);
      const canvas = renderer.domElement;

      const stream = canvas.captureStream(30);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

      const duration = 8;
      const t0 = performance.now();
      const s = p.s;
      const blob = await new Promise((resolve, reject) => {
        const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
        const step = () => {
          const t = (performance.now() - t0) / 1000;
          const u = Math.min(1, t / duration);
          let ix = 0, iy = 0, zoom = 1;
          if (D3D.motion === 'drift') {
            ix = Math.sin(t * 0.55) * 0.55 * (0.4 + s * 0.6);
            iy = Math.cos(t * 0.4) * 0.35 * (0.4 + s * 0.6);
          } else if (D3D.motion === 'kenburns') {
            const k = 0.5 + 0.5 * Math.sin(t * 0.18);
            zoom = 1 + k * 0.16 * (0.3 + s * 0.7);
            ix = Math.sin(t * 0.22) * 0.3;
            iy = Math.cos(t * 0.16) * 0.2;
          } else if (D3D.motion === 'waves') {
            ix = Math.sin(t * 0.5) * 0.3;
            iy = Math.cos(t * 0.42) * 0.2;
          }
          cam.position.x = ix;
          cam.position.y = iy;
          cam.zoom = zoom;
          cam.updateProjectionMatrix();
          mat.uniforms.uTiltX.value = iy * 0.03;
          mat.uniforms.uTiltY.value = ix * 0.04;
          mat.uniforms.uTime.value = t;
          renderer.render(scene, cam);
          if (u < 1) requestAnimationFrame(step);
          else { renderer.render(scene, cam); rec.stop(); done.then(resolve, reject); }
        };
        rec.start();
        requestAnimationFrame(step);
      });
      renderer.dispose(); geo.dispose(); mat.dispose(); texColor.dispose(); texDepth.dispose();

      const url = URL.createObjectURL(blob);
      $('d3dCanvasWrap').classList.add('hidden');
      $('d3dResult').classList.remove('hidden');
      $('d3dResultVideo').src = url;
      $('d3dResultDl').href = url;
      $('d3dResultDl').setAttribute('download', 'pixelforge-3d-' + Date.now() + '.webm');
      setStatus(null);

      // Save to history as a video tile.
      const aspectLabel = aspect >= 1.5 ? '16:9' : (aspect >= 0.9 ? '1:1' : '9:16');
      try {
        const r = await fetch('api.php?action=upload3d' +
          '&mode=' + encodeURIComponent(D3D.depthMode) +
          '&aspect=' + encodeURIComponent(aspectLabel) +
          '&title=' + encodeURIComponent('3D animation of a photo') +
          '&csrf=' + encodeURIComponent(csrfToken), { method: 'POST', body: blob });
        const d = await r.json();
        if (d.ok) { loadHistory(); toast('🎬 3D animation rendered & saved to history!'); }
        else toast('🎬 Rendered! (history save: ' + d.error + ')');
      } catch (e) {
        toast('🎬 Rendered! (history upload failed — use the Download button)');
      }
    } catch (e) {
      setStatus(null);
      toast('Render failed: ' + friendlyError(e), true);
    } finally {
      D3D.busy = false;
      btn.disabled = false;
      btn.querySelector('.gen-label').textContent = 'Render WebM';
    }
  }

  function exportD3DFrame() {
    if (!D3D.engine) { toast('Drop a photo first.', true); return; }
    const url = D3D.engine.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixelforge-3d-frame-' + Date.now() + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('🖼 Frame PNG downloaded.');
  }

  /** Self-contained single-file HTML embed: photo + depth map embedded as
      data URLs, Three.js pulled from the CDN, same parallax effect. */
  function buildEmbedHtml(imgData, depthData, opt) {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const v = D3D_VERT.replace(/\n/g, '\n    ');
    const f = D3D_FRAG.replace(/\n/g, '\n    ');
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>3D Photo — depth parallax</title>',
      '<style>',
      '  * { margin:0; padding:0; box-sizing:border-box; }',
      '  body { min-height:100vh; display:grid; place-items:center; background:#0a0d1a; font-family:system-ui,-apple-system,sans-serif; padding:24px; }',
      '  .stage { position:relative; width:100%; max-width:min(920px,92vw); aspect-ratio:' + opt.aspect + '; border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,.1); box-shadow:0 30px 80px rgba(0,0,0,.55); cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none; }',
      '  .stage img#fallback { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:none; animation:kb 16s ease-in-out infinite alternate; }',
      '  @keyframes kb { from { transform:scale(1) translate(0,0); } to { transform:scale(1.12) translate(-1.5%,1%); } }',
      '  .stage canvas { width:100%; height:100%; display:block; }',
      '  .hint { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.8); background:rgba(8,12,26,.65); border:1px solid rgba(255,255,255,.14); padding:6px 14px; border-radius:999px; backdrop-filter:blur(6px); pointer-events:none; white-space:nowrap; }',
      '</style>',
      '</head>',
      '<body>',
      '<div class="stage" id="stage">',
      '  <img id="fallback" src="' + imgData + '" alt="3D photo">',
      '  <div class="hint">Move your mouse or tilt your phone ✨</div>',
      '</div>',
      '<script src="' + THREE_CDN + '"><\/script>',
      '<script>',
      '(function () {',
      '  var IMG = "' + esc(imgData) + '";',
      '  var DEPTH = "' + esc(depthData) + '";',
      '  var MOTION = "' + opt.motion + '";',
      '  var SPEED = ' + Math.round(opt.speed) + ';',
      '  var STRENGTH = ' + Math.round(opt.strength) + ';',
      '  var stage = document.getElementById("stage");',
      '  var fallback = document.getElementById("fallback");',
      '  if (!window.THREE || !window.WebGLRenderingContext) { fallback.style.display = "block"; return; }',
      '  var THREE = window.THREE;',
      '  var renderer;',
      '  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }',
      '  catch (e) { fallback.style.display = "block"; return; }',
      '  stage.appendChild(renderer.domElement);',
      '  var scene = new THREE.Scene();',
      '  scene.background = new THREE.Color(0x0a0d1a);',
      '  var px = 0, py = 0;',
      '  stage.addEventListener("pointermove", function (e) {',
      '    var r = stage.getBoundingClientRect();',
      '    px = ((e.clientX - r.left) / r.width) * 2 - 1;',
      '    py = -(((e.clientY - r.top) / r.height) * 2 - 1);',
      '  });',
      '  stage.addEventListener("pointerleave", function () { px = 0; py = 0; });',
      '  var vert = ' + JSON.stringify(v) + ';',
      '  var frag = ' + JSON.stringify(f) + ';',
      '  var texColor, texDepth;',
      '  function boot() {',
      '    var A = stage.clientWidth / stage.clientHeight;',
      '    renderer.setSize(stage.clientWidth, stage.clientHeight, false);',
      '    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));',
      '    var cam = new THREE.OrthographicCamera(-6 * A, 6 * A, 6, -6, 0.1, 50);',
      '    cam.position.z = 10;',
      '    var geo = new THREE.PlaneGeometry(9 * A, 9, 128, 128);',
      '    var mat = new THREE.ShaderMaterial({',
      '      uniforms: { uTex: { value: texColor }, uDepth: { value: texDepth }, uAmp: { value: 0 }, uTime: { value: 0 }, uWave: { value: 0 }, uTiltX: { value: 0 }, uTiltY: { value: 0 } },',
      '      vertexShader: vert,',
      '      fragmentShader: frag,',
      '    });',
      '    scene.add(new THREE.Mesh(geo, mat));',
      '    var t0 = performance.now();',
      '    (function step() {',
      '      var t = (performance.now() - t0) / 1000;',
      '      var s = SPEED / 100;',
      '      var ix = 0, iy = 0, zoom = 1;',
      '      if (MOTION === "drift") { ix = Math.sin(t * 0.55) * 0.55 * (0.4 + s * 0.6); iy = Math.cos(t * 0.4) * 0.35 * (0.4 + s * 0.6); }',
      '      else if (MOTION === "kenburns") { var k = 0.5 + 0.5 * Math.sin(t * 0.18); zoom = 1 + k * 0.16 * (0.3 + s * 0.7); ix = Math.sin(t * 0.22) * 0.3; iy = Math.cos(t * 0.16) * 0.2; }',
      '      cam.position.x = ix + px * (0.55 + s * 0.45);',
      '      cam.position.y = iy + py * (0.45 + s * 0.35);',
      '      cam.zoom = zoom; cam.updateProjectionMatrix();',
      '      mat.uniforms.uTiltX.value = py * 0.06 + iy * 0.02;',
      '      mat.uniforms.uTiltY.value = px * 0.08 + ix * 0.03;',
      '      mat.uniforms.uTime.value = t;',
      '      mat.uniforms.uAmp.value = (STRENGTH / 100) * 1.35;',
      '      mat.uniforms.uWave.value = MOTION === "waves" ? 0.03 + s * 0.05 : (MOTION === "none" ? 0 : 0.012 * s);',
      '      renderer.render(scene, cam);',
      '      requestAnimationFrame(step);',
      '    })();',
      '  }',
      '  function draw(im) { var c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); return c; }',
      '  function maybeBoot() { if (img.naturalWidth && dimg.naturalWidth) { texColor = new THREE.CanvasTexture(draw(img)); texDepth = new THREE.CanvasTexture(draw(dimg)); boot(); } }',
      '  var img = new Image();',
      '  var dimg = new Image();',
      '  img.onload = dimg.onload = maybeBoot;',
      '  img.src = IMG;',
      '  dimg.src = DEPTH;',
      '  window.addEventListener("resize", function () { if (stage.clientWidth) renderer.setSize(stage.clientWidth, stage.clientHeight, false); });',
      '})();',
      '<\/script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function exportD3DEmbed() {
    if (!D3D.img) { toast('Drop a photo first.', true); return; }
    if (!D3D.depthCanvas) {
      const dc = buildDepthMap(D3D.img, D3D.depthMode, D3D.smooth);
      D3D.depthCanvas = dc;
      D3D.depthUrl = dc.toDataURL('image/png');
    }
    const html = buildEmbedHtml(D3D.url, D3D.depthUrl, {
      aspect: (D3D.img.naturalWidth / D3D.img.naturalHeight).toFixed(4),
      motion: D3D.motion,
      speed: D3D.speed,
      strength: D3D.strength,
    });
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixelforge-3d-embed.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('📄 Embed HTML downloaded — open it to check the effect, then drop it on your site.');
  }

  function bind3D() {
    $('d3dFile').addEventListener('change', (e) => setD3DImage(e.target.files[0]));
    $('d3dRemove').addEventListener('click', clearD3DImage);
    const drop = $('d3dDrop');
    ['dragover', 'dragenter'].forEach((ev) => {
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('ref-drag'); });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('ref-drag'); });
    });
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setD3DImage(f);
    });

    /* Repaint a range input's gradient fill so it matches its value. */
    const paintRange = (id) => {
      const el = $(id);
      const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
      el.style.backgroundSize = pct + '% 100%';
    };
    const slider = (id, valId, key, onInput) => {
      const el = $(id);
      el.addEventListener('input', () => {
        D3D[key] = parseInt(el.value, 10) || 0;
        $(valId).textContent = el.value;
        paintRange(id);
        if (onInput) onInput();
        saveSession();
      });
      paintRange(id);
    };
    $('d3dDepthMode').addEventListener('change', () => {
      D3D.depthMode = $('d3dDepthMode').value;
      rebuildD3DDepth();
      saveSession();
    });
    slider('d3dStrength', 'd3dStrengthVal', 'strength', applyD3DParams);
    slider('d3dSmooth', 'd3dSmoothVal', 'smooth', rebuildD3DDepth);
    $('d3dMotion').addEventListener('change', () => {
      D3D.motion = $('d3dMotion').value;
      applyD3DParams();
      saveSession();
    });
    slider('d3dSpeed', 'd3dSpeedVal', 'speed', applyD3DParams);

    ['d3dStrength', 'd3dSmooth', 'd3dSpeed'].forEach((id) => {
      paintRange(id); // sync fills on restore
    });

    $('d3dRenderBtn').addEventListener('click', render3DVideo);
    $('d3dEmbedBtn').addEventListener('click', exportD3DEmbed);
    $('d3dFrameBtn').addEventListener('click', exportD3DFrame);
    $('d3dResultBack').addEventListener('click', () => {
      $('d3dResult').classList.add('hidden');
      $('d3dResultVideo').src = '';
      $('d3dCanvasWrap').classList.remove('hidden');
    });
  }

  /* ---------------- session persistence ---------------- */
  function saveSession() {
    try {
      localStorage.setItem('pf_session', JSON.stringify({
        prompt: $('prompt').value,
        negative: $('negative').value,
        style: state.style,
        resolution: state.resolution,
        guidance: $('guidance').value,
        seed: $('seed').value,
        count: state.count,
        videoEngine: state.videoEngine,
        refBlur: state.ref.blur,
        refStyle: state.ref.style,
        refEngine: state.ref.engine,
        refFullBody: state.ref.fullBody,
        storyText: $('storyText').value,
        storyVoice: state.story.voice,
        storyRate: $('storyRate').value,
        storyAspect: state.story.aspect,
        splitRule: $('splitRule').value,
        captions: state.story.captions,
        resW: parseInt($('resW').value, 10) || 768,
        resH: parseInt($('resH').value, 10) || 768,
        d3dDepthMode: D3D.depthMode,
        d3dStrength: D3D.strength,
        d3dSmooth: D3D.smooth,
        d3dMotion: D3D.motion,
        d3dSpeed: D3D.speed,
      }));
    } catch (e) { /* storage unavailable (private mode etc.) */ }
  }

  function restoreSession() {
    try {
      const s = JSON.parse(localStorage.getItem('pf_session') || 'null');
      if (!s) return;
      if (typeof s.prompt === 'string' && s.prompt !== '') $('prompt').value = s.prompt;
      if (typeof s.negative === 'string') $('negative').value = s.negative;
      // Style always starts at None — a previously chosen style is not
      // restored, so the studio reopens on "no style" by default.
      state.style = 'none';
      if (typeof s.resolution === 'string' && ['square', 'portrait', 'landscape', 'custom'].includes(s.resolution)) state.resolution = s.resolution;
      if (typeof s.resW === 'number' && isFinite(s.resW)) $('resW').value = snapDim(s.resW);
      if (typeof s.resH === 'number' && isFinite(s.resH)) $('resH').value = snapDim(s.resH);
      if (typeof s.guidance !== 'undefined') $('guidance').value = s.guidance;
      if (typeof s.seed !== 'undefined') $('seed').value = s.seed;
      if (typeof s.count === 'number') state.count = s.count;
      if (typeof s.videoEngine === 'string' && (s.videoEngine === 'free' || s.videoEngine === 'replicate')) state.videoEngine = s.videoEngine;
      if (typeof s.refBlur === 'number') {
        state.ref.blur = Math.max(0, Math.min(1, s.refBlur));
        $('refBlur').value = Math.round(state.ref.blur * 100);
        $('refBlurVal').textContent = Math.round(state.ref.blur * 100);
      }
      if (typeof s.refStyle === 'string' && REPAINTS[s.refStyle]) state.ref.style = s.refStyle;
      if (typeof s.refEngine === 'string') state.ref.engine = (s.refEngine === 'ai' || s.refEngine === 'free') ? s.refEngine : 'local';
      if (typeof s.refFullBody === 'boolean') state.ref.fullBody = s.refFullBody;
      updateRefUi();
      if (typeof s.storyText === 'string') $('storyText').value = s.storyText;
      if (typeof s.storyVoice === 'string' && s.storyVoice) state.story.voice = s.storyVoice;
      if (typeof s.storyRate === 'string') $('storyRate').value = s.storyRate;
      if (typeof s.storyAspect === 'string') state.story.aspect = s.storyAspect;
      if (typeof s.splitRule === 'string') $('splitRule').value = s.splitRule;
      if (typeof s.captions === 'boolean') state.story.captions = s.captions;
      $('storyCaptions').checked = state.story.captions;
      // 3D mode settings
      if (typeof s.d3dDepthMode === 'string' && ['auto', 'luminance', 'radial', 'vertical', 'flat'].includes(s.d3dDepthMode)) D3D.depthMode = s.d3dDepthMode;
      if (typeof s.d3dStrength === 'number') D3D.strength = Math.max(0, Math.min(100, s.d3dStrength));
      if (typeof s.d3dSmooth === 'number') D3D.smooth = Math.max(0, Math.min(100, s.d3dSmooth));
      if (typeof s.d3dMotion === 'string' && ['drift', 'kenburns', 'waves', 'none'].includes(s.d3dMotion)) D3D.motion = s.d3dMotion;
      if (typeof s.d3dSpeed === 'number') D3D.speed = Math.max(0, Math.min(100, s.d3dSpeed));
      $('d3dDepthMode').value = D3D.depthMode;
      $('d3dMotion').value = D3D.motion;
      $('d3dStrength').value = String(D3D.strength); $('d3dStrengthVal').textContent = String(D3D.strength);
      $('d3dSmooth').value = String(D3D.smooth); $('d3dSmoothVal').textContent = String(D3D.smooth);
      $('d3dSpeed').value = String(D3D.speed); $('d3dSpeedVal').textContent = String(D3D.speed);
      $('promptCount').textContent = $('prompt').value.length + ' / 2000';
    } catch (e) { /* corrupted storage — ignore */ }
  }

  /** Keep the segmented controls' active buttons in sync with state. */
  function syncSegmented(id, key) {
    $(id).querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', (b.dataset.count || b.dataset.res || b.dataset.aspect || b.dataset.ve) === String(key));
    });
  }

  /* ---------------- init ---------------- */
  restoreSession();
  buildStyleSelect();
  buildStoryVoices();
  bindSlider();
  bindRef();
  bind3D();
  bindMisc();
  bindPromptChips();
  bindLightboxZoom();
  loadPromptHistory();
  bindNegPresets();
  bindHistorySearch();

  // Prompt history: click the textarea to toggle the history dropdown
  $('prompt').addEventListener('focus', () => {
    if (promptHistory.length > 0) togglePhDropdown();
  });
  // Close the dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const wrap = $('promptHistoryWrap');
    if (wrap && !wrap.contains(e.target)) closePhDropdown();
  });
  syncSegmented('resSeg', state.resolution);
  syncCustomResRow(); // reveal the W×H inputs when 'custom' was restored
  syncSegmented('countSeg', state.count);
  syncSegmented('aspectSeg', state.story.aspect);    $('genBtn').addEventListener('click', generate);
  $('storyGenBtn').disabled = $('storyText').value.trim() === '';
  bindSegmented('videoEngineSeg', (key) => { state.videoEngine = key; saveSession(); });
  syncSegmented('videoEngineSeg', state.videoEngine);
  checkStatus();
  loadHistory();

  // Does video mode have an API key saved?
  (async () => {
    try {
      const r = await fetch('api.php?action=videokey');
      const d = await r.json();
      if (d.ok) state.videoKey = !!d.has_key;
    } catch (e) { /* offline */ }
  })();
  (async () => {
    try {
      const r = await fetch('api.php?action=pollikey');
      const d = await r.json();
      if (d.ok) state.polliKey = !!d.has_key;
    } catch (e) { /* offline */ }
  })();
  (async () => {
    try {
      const r = await fetch('api.php?action=hfkey');
      const d = await r.json();
      if (d.ok) state.hfKey = !!d.has_key;
      updateRefUi();
    } catch (e) { /* offline */ }
  })();

})();
