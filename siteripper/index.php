<?php
/**
 * SiteRipper — web UI.
 * Export a live site / WordPress demo into an editable static project.
 *
 * Endpoints (this file):
 *   GET  ?action=form                 → HTML UI
 *   POST ?action=start                → create job, returns job id + state
 *   GET  ?action=progress&id=X        → run a batch, return state JSON
 *   GET  ?action=result&id=X          → final state + report text
 *   GET  ?action=download&id=X        → ZIP download
 *   GET  ?action=preview&id=X         → redirect to exported site index
 *   POST ?action=delete&id=X          → remove job
 *   GET  ?action=jobs                 → JSON job list
 */

declare(strict_types=1);
set_time_limit(0);
error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING);

require __DIR__ . '/lib/Ripper.php';

$action = $_GET['action'] ?? ($_POST['action'] ?? 'form');

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

/* ------------------------------------------------------------------ */
/* JSON endpoints                                                     */
/* ------------------------------------------------------------------ */

if ($action === 'jobs') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'jobs' => SiteRipper::listJobs()]);
    exit;
}

if ($action === 'start' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $target = trim((string) ($_POST['target'] ?? ''));
    if ($target === '') {
        echo json_encode(['ok' => false, 'error' => 'Enter a URL or local folder path.']);
        exit;
    }
    try {
        $id = 'rip-' . date('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 6);
        $ripper = new SiteRipper($id, [
            'max_pages'       => max(1, min(2000, (int) ($_POST['max_pages'] ?? 100))),
            'max_depth'       => max(1, min(25, (int) ($_POST['max_depth'] ?? 5))),
            'external_assets' => !empty($_POST['external_assets']),
            'download_media'  => !empty($_POST['download_media']),
            'respect_robots'  => !empty($_POST['respect_robots']),
            'speed'           => strtolower((string) ($_POST['speed'] ?? 'balanced')),
        ]); 
        // constructor normalizes invalid speeds to 'balanced'
        $state = $ripper->start($target);
        echo json_encode(['ok' => true, 'id' => $id, 'state' => $state]);
    } catch (Throwable $e) {
        echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($action === 'progress' && isset($_GET['id'])) {
    header('Content-Type: application/json; charset=utf-8');
    $ripper = new SiteRipper((string) $_GET['id']);
    if (!$ripper->loadState()) {
        echo json_encode(['ok' => false, 'error' => 'Job not found.']);
        exit;
    }
    $ripper->runBatch(8);
    echo json_encode(['ok' => true, 'state' => $ripper->getState()]);
    exit;
}

if ($action === 'result' && isset($_GET['id'])) {
    header('Content-Type: application/json; charset=utf-8');
    $ripper = new SiteRipper((string) $_GET['id']);
    if (!$ripper->loadState()) {
        echo json_encode(['ok' => false, 'error' => 'Job not found.']);
        exit;
    }
    $report = '';
    $reportPath = RIPPER_JOBS_DIR . '/' . $ripper->getJobId() . '/report.txt';
    if (is_file($reportPath)) {
        $report = (string) @file_get_contents($reportPath);
    }
    echo json_encode(['ok' => true, 'state' => $ripper->getState(), 'report' => $report]);
    exit;
}

if ($action === 'download' && isset($_GET['id'])) {
    $ripper = new SiteRipper((string) $_GET['id']);
    if (!$ripper->loadState()) {
        http_response_code(404);
        exit('Job not found.');
    }
    $zip = $ripper->createZip();
    if ($zip === null || !is_file($zip)) {
        http_response_code(500);
        exit('ZIP could not be created (is the PHP zip extension enabled?).');
    }
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $ripper->getJobId() . '-export.zip"');
    header('Content-Length: ' . filesize($zip));
    readfile($zip);
    exit;
}

if ($action === 'preview' && isset($_GET['id'])) {
    $ripper = new SiteRipper((string) $_GET['id']);
    if (!$ripper->loadState() || !is_dir($ripper->getSiteDir())) {
        http_response_code(404);
        exit('Job not found.');
    }
    $index = $ripper->getSiteDir() . '/index.html';
    if (!is_file($index)) {
        // Prefer the start URL's own path (e.g. /wp38/ -> wp38/index.html),
        // then any top-level candidate.
        $st = $ripper->getState();
        $startPath = trim((string) parse_url($st['start_url'] ?? '', PHP_URL_PATH), '/');
        $candidate = $startPath !== '' ? $ripper->getSiteDir() . '/' . $startPath . '/index.html' : '';
        if ($candidate !== '' && is_file($candidate)) {
            $index = $candidate;
        } else {
            $candidates = glob($ripper->getSiteDir() . '/*/index.html') ?: [];
            $index = $candidates[0] ?? '';
        }
    }
    if ($index !== '') {
        // Pretty URL: site/<job>/<relpath> (rewritten by .htaccess to ?action=view)
        // so relative links inside the exported pages resolve correctly.
        $rel = ltrim(str_replace($ripper->getSiteDir(), '', $index), '/');
        header('Location: site/' . rawurlencode($ripper->getJobId()) . '/' . $rel);
    } else {
        header('Location: ?action=form');
    }
    exit;
}

if ($action === 'delete' && isset($_GET['id'])) {
    header('Content-Type: application/json; charset=utf-8');
    $ok = SiteRipper::deleteJob((string) $_GET['id']);
    echo json_encode(['ok' => $ok]);
    exit;
}

if ($action === 'view' && isset($_GET['id'])) {
    // static file server for the exported site (relative links work)
    $ripper = new SiteRipper((string) $_GET['id']);
    $siteDir = $ripper->getSiteDir();
    $file = (string) ($_GET['file'] ?? '/index.html');
    $file = ltrim($file, '/');
    $full = realpath($siteDir . '/' . $file);
    $siteRoot = realpath($siteDir);
    if ($full === false || $siteRoot === false || !str_starts_with($full, $siteRoot)) {
        http_response_code(404);
        exit('Not found.');
    }
    if (is_dir($full)) {
        $full .= '/index.html';
        if (!is_file($full)) {
            http_response_code(404);
            exit('Not found.');
        }
    }
    $ext = strtolower(pathinfo($full, PATHINFO_EXTENSION));
    $mimes = [
        'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8',
        'css' => 'text/css', 'js' => 'application/javascript', 'mjs' => 'application/javascript',
        'json' => 'application/json', 'xml' => 'application/xml', 'txt' => 'text/plain; charset=utf-8',
        'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'avif' => 'image/avif', 'ico' => 'image/x-icon',
        'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'otf' => 'font/otf', 'eot' => 'application/vnd.ms-fontobject',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mp3' => 'audio/mpeg', 'ogg' => 'audio/ogg', 'wav' => 'audio/wav',
        'pdf' => 'application/pdf', 'zip' => 'application/zip',
    ];
    header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
    readfile($full);
    exit;
}

/* ------------------------------------------------------------------ */
/* HTML UI                                                            */
/* ------------------------------------------------------------------ */

$jobs = SiteRipper::listJobs();
$initialUrl = htmlspecialchars((string) ($_GET['url'] ?? ''), ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SiteRipper — Export any site into an editable project</title>
<style>
    /* ============================================================
       SITER1PPER — CRT terminal styling (hacker aesthetic)
       ============================================================ */
    :root{
        --bg:#020603;
        --screen-bg:#030805;
        --panel:#04120a;
        --panel2:#020d06;
        --line:#12331e;
        --fg:#33ff66;
        --fg-dim:#1f8f43;
        --fg-faint:#0f5c2b;
        --glow:rgba(51,255,102,.55);
        --glow-soft:rgba(51,255,102,.16);
        --accent:#b8ffc9;
        --amber:#ffb000;
        --red:#ff5f57;
        --scanline:rgba(0,0,0,.22);
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
        font-family:"JetBrains Mono","Cascadia Code",Consolas,"Courier New",monospace;
        background:
            radial-gradient(ellipse at 50% 40%, #04120a 0%, #000 70%);
        color:var(--fg); min-height:100vh; line-height:1.55;
        text-shadow:0 0 6px var(--glow);
    }

    /* CRT scanlines + vignette over everything */
    body::after{
        content:"";position:fixed;inset:0;pointer-events:none;z-index:9999;
        background:repeating-linear-gradient(to bottom,
            transparent 0px, transparent 2px,
            var(--scanline) 3px, var(--scanline) 4px);
        opacity:.5;mix-blend-mode:multiply;
    }
    body::before{
        content:"";position:fixed;inset:0;pointer-events:none;z-index:9998;
        background:radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%);
    }

    .wrap{max-width:1060px;margin:0 auto;padding:28px 20px 80px;position:relative;z-index:2}
    header.top{display:flex;align-items:center;gap:14px;margin-bottom:6px}
    .logo{
        width:46px;height:46px;border-radius:10px;flex:none;
        border:1px solid var(--fg-dim);
        background:rgba(0,0,0,.55);
        display:grid;place-items:center;
        box-shadow:0 0 18px var(--glow-soft), inset 0 0 12px rgba(0,0,0,.7);
    }
    .logo svg{width:26px;height:26px;stroke:var(--fg);filter:drop-shadow(0 0 4px var(--glow))}
    h1{font-size:22px;letter-spacing:2px;color:var(--fg);animation:flicker 4s infinite}
    h1 span{color:var(--accent);text-shadow:0 0 10px var(--glow)}
    h1::after{content:"▌";animation:blink 1s steps(1) infinite;margin-left:4px;color:var(--fg)}
    @keyframes blink{50%{opacity:0}}
    @keyframes flicker{
        0%,100%{opacity:1} 92%{opacity:1} 93%{opacity:.6}
        94%{opacity:1} 97%{opacity:.8} 98%{opacity:1}
    }
    .tagline{color:var(--fg-dim);font-size:13px;margin-bottom:26px}
    .tagline b{color:var(--fg);font-weight:700}

    .card{
        background:var(--panel);border:1px solid var(--line);border-radius:10px;
        padding:22px;margin-bottom:22px;
        box-shadow:inset 0 0 40px rgba(0,0,0,.6), 0 0 20px var(--glow-soft);
        position:relative;
    }
    .card h2{
        font-size:13px;margin-bottom:16px;display:flex;align-items:center;gap:8px;
        letter-spacing:2px;text-transform:uppercase;color:var(--fg-dim);
    }
    .card h2 .dot{width:8px;height:8px;border-radius:50%;background:var(--fg);box-shadow:0 0 12px var(--glow);animation:blink 1.6s steps(1) infinite}

    label{font-size:11px;color:var(--fg-dim);display:block;margin-bottom:6px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
    .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
    .grow{flex:1;min-width:280px}
    input[type=text],input[type=number]{
        width:100%;background:rgba(0,0,0,.6);border:1px solid var(--fg-faint);color:var(--fg);
        border-radius:6px;padding:12px 14px;font-size:14px;outline:none;
        font-family:inherit;caret-color:var(--fg);
        transition:border-color .2s, box-shadow .2s;
    }
    input:focus{border-color:var(--fg);box-shadow:0 0 0 3px var(--glow-soft), 0 0 14px var(--glow-soft)}
    input::placeholder{color:var(--fg-faint)}
    input[type=number]{width:90px;padding:10px 12px}
    input[type=checkbox]{accent-color:var(--fg);width:15px;height:15px;margin-right:7px;transform:translateY(1px)}

    .checks{display:flex;flex-wrap:wrap;gap:8px 22px;margin:14px 0 4px;font-size:13px;color:var(--fg)}
    .checks label{display:flex;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--fg);font-weight:400;cursor:pointer}

    /* speed segmented control */
    .speed-row{display:flex;align-items:center;gap:12px;margin:16px 0 10px;flex-wrap:wrap}
    .speed-label{font-size:11px;color:var(--fg-dim);font-weight:700;letter-spacing:1px;text-transform:uppercase}
    .seg{display:inline-flex;background:rgba(0,0,0,.6);border:1px solid var(--line);border-radius:6px;padding:3px;gap:2px}
    .seg-btn{position:relative;cursor:pointer}
    .seg-btn input{position:absolute;opacity:0;inset:0;cursor:pointer}
    .seg-btn span{
        display:inline-block;padding:7px 16px;border-radius:4px;font-size:12.5px;font-weight:600;
        color:var(--fg-dim);transition:all .18s;white-space:nowrap;
    }
    .seg-btn:hover span{color:var(--fg);text-shadow:0 0 8px var(--glow)}
    .seg-btn input:checked + span{
        background:var(--fg);color:#000;text-shadow:none;
        box-shadow:0 0 16px var(--glow);
    }
    .seg-btn input:focus-visible + span{outline:2px solid var(--accent);outline-offset:2px}

    .btn{
        display:inline-flex;align-items:center;gap:8px;justify-content:center;
        background:none;color:var(--fg);border:1px solid var(--fg);
        border-radius:6px;padding:12px 20px;font-size:13px;font-weight:600;cursor:pointer;
        text-decoration:none;transition:all .18s;font-family:inherit;letter-spacing:1px;
        text-shadow:0 0 6px var(--glow);box-shadow:0 0 12px var(--glow-soft);
    }
    .btn:hover{background:var(--fg);color:#000;text-shadow:none;box-shadow:0 0 22px var(--glow)}
    .btn.primary{
        background:var(--fg);border:1px solid var(--fg);color:#000;text-shadow:none;
        box-shadow:0 0 22px var(--glow);
    }
    .btn.primary:hover{filter:brightness(1.15);box-shadow:0 0 30px var(--glow)}
    .btn.primary:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
    .btn.sm{padding:6px 12px;font-size:11.5px;border-radius:4px;letter-spacing:.5px}
    .btn.danger{border-color:var(--red);color:var(--red);text-shadow:0 0 6px rgba(255,95,87,.5);box-shadow:none}
    .btn.danger:hover{background:var(--red);color:#000;text-shadow:none;box-shadow:0 0 16px rgba(255,95,87,.6)}
    .btn.ghost{border-color:var(--fg-dim);color:var(--fg-dim);text-shadow:none;box-shadow:none}
    .btn.ghost:hover{background:var(--fg-dim);color:#000;border-color:var(--fg-dim)}

    .spinner{
        width:20px;height:20px;border:2.5px solid rgba(51,255,102,.25);border-top-color:var(--fg);
        border-radius:50%;animation:spin .8s linear infinite;flex:none;
    }
    @keyframes spin{to{transform:rotate(360deg)}}

    /* progress */
    .bar{height:14px;background:rgba(0,0,0,.6);border:1px solid var(--fg-dim);border-radius:2px;overflow:hidden;margin:6px 0 18px;padding:2px}
    .bar>div{height:100%;width:0%;background:var(--fg);transition:width .5s ease;box-shadow:0 0 14px var(--glow)}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:14px}
    .stat{background:rgba(0,0,0,.55);border:1px solid var(--line);border-radius:6px;padding:12px 14px}
    .stat b{display:block;font-size:21px;letter-spacing:1px;color:var(--fg);text-shadow:0 0 8px var(--glow)}
    .stat span{font-size:10.5px;color:var(--fg-dim);text-transform:uppercase;letter-spacing:1px}
    .status-line{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--fg-dim)}
    .status-line .live{color:var(--fg);text-shadow:0 0 8px var(--glow)}

    .pill{display:inline-block;padding:2px 10px;border-radius:2px;font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border:1px solid}
    .pill.done{color:var(--fg);border-color:var(--fg-dim);background:rgba(51,255,102,.08);text-shadow:0 0 6px var(--glow)}
    .pill.running{color:var(--amber);border-color:var(--amber);background:rgba(255,176,0,.08);text-shadow:0 0 6px rgba(255,176,0,.5);animation:blink 1.4s steps(1) infinite}
    .pill.unknown{color:var(--fg-dim);border-color:var(--fg-faint);background:rgba(31,143,67,.06)}

    table{width:100%;border-collapse:collapse;font-size:12.5px}
    th{text-align:left;color:var(--fg-dim);font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:8px 10px;border-bottom:1px solid var(--fg-faint)}
    td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:rgba(51,255,102,.045)}
    .url-cell{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
    .num{font-variant-numeric:tabular-nums}
    .actions{display:flex;gap:6px;flex-wrap:wrap}
    .empty{color:var(--fg-dim);text-align:center;padding:26px 10px;font-size:13px;font-style:italic}

    pre.report{
        background:rgba(0,0,0,.6);border:1px solid var(--fg-faint);border-radius:6px;padding:14px;
        font-size:12px;line-height:1.6;overflow:auto;max-height:320px;color:var(--fg-dim);
        white-space:pre-wrap;word-break:break-word;
    }
    .hint{font-size:11.5px;color:var(--fg-dim);margin-top:6px}
    .hint b{color:var(--fg)}
    .toast{
        position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);
        background:#1a0505;border:1px solid var(--red);color:var(--red);
        padding:11px 20px;border-radius:6px;font-size:13px;
        opacity:0;pointer-events:none;transition:all .3s;z-index:50;
        box-shadow:0 0 24px rgba(255,95,87,.35);text-shadow:0 0 8px rgba(255,95,87,.6);
    }
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .hidden{display:none!important}
    footer{color:var(--fg-faint);font-size:11px;margin-top:30px;text-align:center;letter-spacing:1px}
    footer b{color:var(--fg-dim)}
    .chip{margin-top:12px}
    .chip button{
        background:rgba(51,255,102,.06);border:1px solid var(--fg-faint);color:var(--fg-dim);
        border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;margin-right:6px;
        font-family:inherit;letter-spacing:.5px;transition:all .15s;
    }
    .chip button:hover{color:var(--fg);border-color:var(--fg);background:rgba(51,255,102,.12);text-shadow:0 0 6px var(--glow)}
    summary{cursor:pointer;font-size:12px;color:var(--fg-dim)}
    summary:hover{color:var(--fg)}
    @media (max-width:720px){ h1{font-size:18px} .wrap{padding:18px 12px 60px} }
</style>
</head>
<body>
<div class="wrap">

    <header class="top">
        <div class="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/>
            </svg>
        </div>
        <div>
            <h1>Site<span>Ripper</span></h1>
        </div>
    </header>
    <p class="tagline">&gt; SITER1PPER v<?= SiteRipper::VERSION ?> — <b>extract a live site</b> (or WordPress demo like <b>demo.pro.radio/wp38</b>) into an <b>editable static project</b>. Local folders supported. Use only on targets you own or have permission to rip.</p>

    <div class="card">
        <h2><span class="dot"></span>// target acquisition</h2>
        <form id="rip-form" autocomplete="off">
            <label>Target — URL or local folder path</label>
            <div class="row">
                <input type="text" id="target" name="target" placeholder="https://demo.pro.radio/wp38" value="<?= $initialUrl ?>" required>
                <button type="submit" class="btn primary" id="go-btn">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    INITIATE RIP
                </button>
            </div>
            <div class="chip">
                <button type="button" data-fill="https://demo.pro.radio/wp38">Try: Pro Radio WP demo</button>
                <button type="button" data-fill="https://www.w3schools.com">Try: w3schools.com</button>
                <button type="button" data-fill="C:/xampp/htdocs/2026/AttanNew/Tools/html_backup">Local template folder</button>
            </div>
            <div class="checks">
                <label><input type="checkbox" id="download_media" name="download_media" checked> Images &amp; media</label>
                <label><input type="checkbox" id="external_assets" name="external_assets"> External host assets</label>
                <label><input type="checkbox" id="respect_robots" name="respect_robots"> Respect robots.txt</label>
            </div>
            <div class="checks">
                <label style="gap:6px">Max pages <input type="number" name="max_pages" value="100" min="1" max="2000"></label>
                <label style="gap:6px">Max depth <input type="number" name="max_depth" value="5" min="1" max="25"></label>
            </div>
            <div class="speed-row">
                <span class="speed-label">Speed</span>
                <div class="seg" id="speed-seg">
                    <label class="seg-btn" title="No delay between requests, no retries — quick rips on friendly sites"><input type="radio" name="speed" value="fast"><span>⚡ Fast</span></label>
                    <label class="seg-btn" title="Modest delay + retries — good default for most sites"><input type="radio" name="speed" value="balanced" checked><span>Balanced</span></label>
                    <label class="seg-btn" title="Slow + many retries — safest on Cloudflare/CDN-protected hosts"><input type="radio" name="speed" value="polite"><span>🐢 Polite</span></label>
                </div>
            </div>
            <p class="hint" id="speed-hint">Balanced — ~0.35s between requests, retries on hiccups. Pick <b>Fast</b> for quick rips, <b>Polite</b> for rate-limited hosts.</p>
            <p class="hint">Runs locally — target only sites you have permission to export. External-host assets stay as absolute links unless enabled.</p>
        </form>
    </div>

    <!-- progress -->
    <div class="card hidden" id="progress-card">
        <h2><span class="dot"></span>// ripping <span id="prog-target" style="color:var(--fg);font-weight:500;font-size:13px"></span></h2>
        <div class="bar"><div id="bar-fill"></div></div>
        <div class="stats">
            <div class="stat"><b id="stat-pages" class="num">0</b><span>Pages</span></div>
            <div class="stat"><b id="stat-assets" class="num">0</b><span>Assets</span></div>
            <div class="stat"><b id="stat-bytes" class="num">0</b><span>Size</span></div>
            <div class="stat"><b id="stat-queue" class="num">0</b><span>Queued</span></div>
            <div class="stat"><b id="stat-failed" class="num">0</b><span>Failed</span></div>
        </div>
        <div class="status-line"><span class="spinner"></span> <span id="prog-msg" class="live">Crawling…</span></div>
    </div>

    <!-- result -->
    <div class="card hidden" id="result-card">
        <h2><span class="dot" style="background:var(--fg);box-shadow:0 0 12px var(--glow)"></span>// rip complete</h2>
        <div class="stats">
            <div class="stat"><b id="r-pages" class="num">0</b><span>Pages</span></div>
            <div class="stat"><b id="r-assets" class="num">0</b><span>Assets</span></div>
            <div class="stat"><b id="r-bytes" class="num">0</b><span>Size</span></div>
            <div class="stat"><b id="r-failed" class="num">0</b><span>Failed</span></div>
            <div class="stat"><b id="r-time" class="num">0s</b><span>Duration</span></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
            <a class="btn primary" id="btn-preview">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Preview exported site
            </a>
            <a class="btn" id="btn-zip">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Download ZIP
            </a>
            <button class="btn ghost" id="btn-new">New export</button>
        </div>
        <details>
            <summary style="cursor:pointer;font-size:13px;color:var(--muted);margin-bottom:10px">Show report / failures</summary>
            <pre class="report" id="report"></pre>
        </details>
    </div>

    <!-- job list -->
    <div class="card">
        <h2><span class="dot"></span>// previous rips</h2>
        <div id="jobs-wrap">
            <?php if (empty($jobs)): ?>
                <p class="empty">No exports yet — rip something!</p>
            <?php else: ?>
            <table>
                <thead><tr><th>Job</th><th>Pages</th><th>Assets</th><th>Size</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                <?php foreach ($jobs as $j): ?>
                    <tr>
                        <td>
                            <div class="url-cell" title="<?= htmlspecialchars($j['start_url']) ?>"><?= htmlspecialchars(mb_strimwidth($j['start_url'], 0, 44, '…')) ?></div>
                            <div style="color:var(--muted);font-size:11px"><?= date('M j, H:i', (int) $j['started_at']) ?></div>
                        </td>
                        <td class="num"><?= (int) $j['pages'] ?></td>
                        <td class="num"><?= (int) $j['assets'] ?></td>
                        <td class="num"><?= $j['bytes'] > 1048576 ? round($j['bytes'] / 1048576, 1) . ' MB' : round($j['bytes'] / 1024) . ' KB' ?></td>
                        <td><span class="pill <?= $j['status'] ?>"><?= $j['status'] ?></span></td>
                        <td>
                            <div class="actions">
                                <a class="btn sm" href="?action=preview&id=<?= urlencode($j['id']) ?>">Preview</a>
                                <a class="btn sm" href="?action=download&id=<?= urlencode($j['id']) ?>">ZIP</a>
                                <button class="btn sm danger" onclick="delJob('<?= htmlspecialchars($j['id']) ?>')">Delete</button>
                            </div>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>
    </div>

    <footer>siteRipper <b>v<?= SiteRipper::VERSION ?></b> · local dev tool · jobs stored under <b>siteripper/jobs/</b> · <span id="st-clock"></span></footer>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
    const $  = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const toast = msg => {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3600);
    };

    // sample buttons
    $$('.chip button').forEach(b => b.addEventListener('click', () => {
        $('#target').value = b.dataset.fill;
    }));

    // speed selector hint
    const speedHints = {
        fast: 'Fast — no delay between requests, no retries. Quickest for friendly sites, but riskier on Cloudflare/CDN-protected hosts.',
        balanced: 'Balanced — ~0.35s between requests, retries on hiccups. Good default for most sites.',
        polite: 'Polite — ~1s between requests, up to 5 attempts. Slowest but safest on rate-limited hosts.'
    };
    $$('.seg-btn input[name=speed]').forEach(r => r.addEventListener('change', () => {
        $('#speed-hint').innerHTML = speedHints[r.value] || '';
    }));

    const form = $('#rip-form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const target = $('#target').value.trim();
        if (!target) return;

        $('#progress-card').classList.remove('hidden');
        $('#result-card').classList.add('hidden');
        $('#prog-target').textContent = target;
        $('#prog-msg').textContent = 'Starting…';
        $('#bar-fill').style.width = '0%';
        const btn = $('#go-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Exporting…';

        try {
            const res = await fetch('?action=start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(new FormData(form))
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || 'Could not start export.');
            await poll(data.id);
        } catch (err) {
            $('#progress-card').classList.add('hidden');
            toast(err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export site';
        }
    });

    async function poll(id) {
        const maxPages = parseInt($('input[name=max_pages]').value || '100', 10);
        const start = Date.now();
        for (;;) {
            let data;
            try {
                data = await (await fetch('?action=progress&id=' + encodeURIComponent(id))).json();
            } catch { await sleep(600); continue; }
            if (!data.ok) throw new Error(data.error || 'Job failed.');

            const s = data.state;
            $('#stat-pages').textContent  = s.pages;
            $('#stat-assets').textContent = s.assets;
            $('#stat-bytes').textContent  = fmt(s.bytes);
            $('#stat-queue').textContent  = (s.queue || []).length;
            $('#stat-failed').textContent = (s.failed || []).length;
            $('#prog-msg').textContent    = s.message || 'Working…';
            $('#bar-fill').style.width    = Math.min(100, Math.round((s.pages / maxPages) * 100)) + '%';

            if (s.status === 'done' || s.status === 'error') {
                await showResult(id, start);
                return;
            }
            await sleep(700);
        }
    }

    async function showResult(id, start) {
        const data = await (await fetch('?action=result&id=' + encodeURIComponent(id))).json();
        const s = data.state;
        $('#progress-card').classList.add('hidden');
        $('#result-card').classList.remove('hidden');
        $('#r-pages').textContent  = s.pages;
        $('#r-assets').textContent = s.assets;
        $('#r-bytes').textContent  = fmt(s.bytes);
        $('#r-failed').textContent = (s.failed || []).length;
        $('#r-time').textContent   = Math.round((Date.now() - start) / 1000) + 's';
        $('#report').textContent   = data.report || 'No report.';
        $('#btn-preview').href     = '?action=preview&id=' + encodeURIComponent(id);
        $('#btn-zip').href         = '?action=download&id=' + encodeURIComponent(id);
        refreshJobs();
    }

    $('#btn-new').addEventListener('click', () => {
        $('#result-card').classList.add('hidden');
        $('#target').focus();
    });

    // clock in the footer (terminal vibe)
    (function clock(){
        const el = document.getElementById('st-clock');
        if (el) {
            const tick = () => { el.textContent = new Date().toISOString().replace('T',' ').slice(0,19) + ' UTC'; };
            tick(); setInterval(tick, 1000);
        }
    })();

    window.delJob = async id => {
        if (!confirm('Delete this export?')) return;
        await fetch('?action=delete&id=' + encodeURIComponent(id));
        refreshJobs();
    };

    async function refreshJobs() {
        try {
            const data = await (await fetch('?action=jobs')).json();
            const wrap = $('#jobs-wrap');
            if (!data.jobs.length) {
                wrap.innerHTML = '<p class="empty">No exports yet — rip something!</p>';
                return;
            }
            wrap.innerHTML = tableHTML(data.jobs);
        } catch {}
    }

    function tableHTML(jobs) {
        const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const rows = jobs.map(j => `
            <tr>
                <td>
                    <div class="url-cell" title="${esc(j.start_url)}">${esc((j.start_url || '').slice(0, 44))}</div>
                    <div style="color:var(--muted);font-size:11px">${new Date((j.started_at||0)*1000).toLocaleString()}</div>
                </td>
                <td class="num">${j.pages}</td>
                <td class="num">${j.assets}</td>
                <td class="num">${j.bytes > 1048576 ? (j.bytes/1048576).toFixed(1) + ' MB' : Math.round(j.bytes/1024) + ' KB'}</td>
                <td><span class="pill ${esc(j.status)}">${esc(j.status)}</span></td>
                <td>
                    <div class="actions">
                        <a class="btn sm" href="?action=preview&id=${esc(j.id)}">Preview</a>
                        <a class="btn sm" href="?action=download&id=${esc(j.id)}">ZIP</a>
                        <button class="btn sm danger" onclick="delJob('${esc(j.id)}')">Delete</button>
                    </div>
                </td>
            </tr>`).join('');
        return `<table><thead><tr><th>Job</th><th>Pages</th><th>Assets</th><th>Size</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    const fmt = b => b >= 1048576 ? (b/1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b/1024) + ' KB' : b + ' B';
})();
</script>
</body>
</html>
