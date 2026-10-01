<?php
/**
 * TUBEMP3 — YouTube audio liberation backend.
 *
 * Primary engine: yt-dlp + ffmpeg (true MP3 conversion at chosen kbps).
 * Fallback engine: pure-PHP extraction of the audio stream (no ffmpeg
 * needed) — serves the native stream when its URL is exposed directly.
 *
 * Endpoints:
 *   GET  api.php?action=status            -> engine + folder health
 *   GET  api.php?action=info&url=...      -> video metadata (title/thumb/audio)
 *   POST api.php?action=convert           -> stream NDJSON progress, then done
 *   GET  api.php?action=download&file=... -> serve a liberated file
 *
 * Security: URLs are strictly validated to YouTube, the 11-char video ID is
 * extracted, and only that ID ever reaches the engine (no shell, proc_open
 * with an argv array). Downloads are limited to files inside data/out/.
 */
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
set_time_limit(0);

define('OUT_DIR', __DIR__ . '/data/out');
define('YT_ID_RE', '/^[A-Za-z0-9_-]{11}$/');
define('USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

// Optional self-hosted Node engine (node server.js) — preferred when running.
define('NODE_URL', 'http://127.0.0.1:8777');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function out(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400): void
{
    out(['ok' => false, 'error' => $message], $code);
}

function ensure_dirs(): void
{
    if (!is_dir(OUT_DIR)) {
        mkdir(OUT_DIR, 0775, true);
    }
}

/** Locate a binary on PATH (yt-dlp, ffmpeg). Returns full path or null. */
function find_bin(string $name): ?string
{
    // Look next to this script first (drop yt-dlp.exe / ffmpeg.exe in tubemp3/)
    foreach ([__DIR__ . '/' . $name, __DIR__ . '/bin/' . $name, __DIR__ . '/' . $name . '.exe', __DIR__ . '/bin/' . $name . '.exe'] as $p) {
        if (is_file($p)) {
            return $p;
        }
    }
    if (PHP_OS_FAMILY === 'Windows') {
        $which = @shell_exec('where ' . $name . ' 2>NUL');
    } else {
        $which = @shell_exec('which ' . $name . ' 2>/dev/null');
    }
    if ($which) {
        $first = trim(explode("\n", $which)[0]);
        if ($first !== '') {
            return $first;
        }
    }
    return null;
}

/**
 * Is the self-hosted Node engine (server.js) alive? Cached per request.
 */
function node_alive(): bool
{
    static $alive = null;
    if ($alive !== null) {
        return $alive;
    }
    $alive = false;
    if (!function_exists('curl_init')) {
        return $alive;
    }
    $ch = curl_init(NODE_URL . '/health');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS     => 1500,
        CURLOPT_CONNECTTIMEOUT_MS => 800,
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    $j = json_decode((string) $body, true);
    $alive = is_array($j) && ($j['ok'] ?? false) === true && ($j['engine'] ?? '') === 'NODE';
    return $alive;
}

/** GET against the Node engine, returning decoded JSON or null. */
function node_get(string $path, int $timeout = 90): ?array
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init(NODE_URL . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 3,
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    $j = json_decode((string) $body, true);
    return is_array($j) ? $j : null;
}

/**
 * Extract a canonical YouTube video ID from an arbitrary link.
 * Only youtube.com / youtu.be hosts are accepted — this is the SSRF guard.
 */
function extract_video_id(string $url): ?string
{
    $url = trim($url);
    if ($url === '') {
        return null;
    }
    if (!preg_match('#^https?://#i', $url)) {
        $url = 'https://' . $url; // tolerate bare links
    }
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    if ($host === '') {
        return null;
    }
    // host must be youtube.com or youtu.be (with optional subdomains)
    if (!preg_match('#(^|\.)(youtube\.com|youtu\.be)$#', $host)) {
        return null;
    }
    // youtu.be/<id>
    if (preg_match('#youtu\.be/([A-Za-z0-9_-]{11})#', $url, $m)) {
        return $m[1];
    }
    // watch?v=<id>  |  shorts/<id>  |  embed/<id>  |  live/<id>
    if (preg_match('#[?&]v=([A-Za-z0-9_-]{11})#', $url, $m)) {
        return $m[1];
    }
    if (preg_match('#/(?:shorts|embed|live|v)/([A-Za-z0-9_-]{11})#', $url, $m)) {
        return $m[1];
    }
    return null;
}

/** URL for a validated ID — the only thing ever handed to the engine. */
function canonical_url(string $id): string
{
    return 'https://www.youtube.com/watch?v=' . $id;
}

/** Sanitize a title for use in a filename. */
function safe_name(string $s): string
{
    $s = preg_replace('/[\\\\\/:*?"<>|\x00-\x1F]/', '_', $s);
    $s = preg_replace('/\s+/', ' ', $s);
    $s = trim($s, " ._");
    return $s === '' ? 'track' : mb_substr($s, 0, 80);
}

/** Pretty-print bytes. */
function human_size(int $bytes): string
{
    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 1) . ' MiB';
    }
    if ($bytes >= 1024) {
        return number_format($bytes / 1024, 1) . ' KiB';
    }
    return $bytes . ' B';
}

/** HTTP GET returning body string (browser-style). */
function http_get(string $url, int $timeout = 30): ?string
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => USER_AGENT,
        CURLOPT_HTTPHEADER     => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
        ],
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return is_string($body) && $body !== '' ? $body : null;
}

/* ------------------------------------------------------------------ */
/* Engine detection                                                    */
/* ------------------------------------------------------------------ */

function engine_status(): array
{
    ensure_dirs();
    $ytdlp  = find_bin('yt-dlp');
    $ffmpeg = find_bin('ffmpeg');
    $node   = node_alive();
    $files  = is_dir(OUT_DIR) ? glob(OUT_DIR . '/*.{mp3,m4a,opus,webm,ogg}', GLOB_BRACE) : [];
    $files  = $files ?: [];

    $engine = 'LEGACY';
    if ($node) {
        $engine = 'NODE';
    } elseif ($ytdlp && $ffmpeg) {
        $engine = 'FULL';
    } elseif ($ytdlp) {
        $engine = 'YTDLP-NO-FFMPEG';
    }

    return [
        'ok'       => true,
        'engine'   => $engine,
        'node'     => $node,
        'ytdlp'    => $ytdlp !== null,
        'ytdlpBin' => $ytdlp !== null ? basename((string) $ytdlp) : null,
        'ffmpeg'   => $ffmpeg !== null || $node,
        'ffmpegBin'=> $ffmpeg !== null ? basename((string) $ffmpeg) : ($node ? 'bundled (node engine)' : null),
        'phpCurl'  => function_exists('curl_init'),
        'outWritable' => is_writable(OUT_DIR),
        'files'    => count($files),
        'qualities'=> ($node || ($ytdlp && $ffmpeg)) ? ['64', '128', '192', '320', 'source'] : ['source'],
        'note'     => $node ? null
            : ($ytdlp && $ffmpeg ? null
              : ($ytdlp ? 'ffmpeg not found — MP3 conversion disabled (SOURCE only). Drop ffmpeg.exe next to api.php.'
                        : 'no engine found — run `node server.js` in tubemp3/ for full MP3 quality, or install yt-dlp (+ffmpeg).')),
    ];
}

/* ------------------------------------------------------------------ */
/* Info via yt-dlp                                                     */
/* ------------------------------------------------------------------ */

function info_with_ytdlp(string $id): array
{
    $bin  = find_bin('yt-dlp');
    $args = [
        $bin,
        '--no-playlist',
        '--no-warnings',
        '--skip-download',
        '--dump-single-json',
        '--no-check-certificate',
        canonical_url($id),
    ];
    $proc = proc_open($args, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($proc)) {
        return ['ok' => false, 'error' => 'could not start yt-dlp'];
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($proc);

    $data = json_decode((string) $stdout, true);
    if (!is_array($data) || ($data['id'] ?? null) !== $id) {
        return ['ok' => false, 'error' => 'yt-dlp could not resolve this video: ' . trim(substr((string) $stderr, 0, 220))];
    }

    // pick best audio formats
    $audio = [];
    foreach (($data['formats'] ?? []) as $f) {
        if (!is_array($f) || str_starts_with((string) ($f['vcodec'] ?? 'none'), 'none')) {
            $audio[] = $f;
        }
    }
    usort($audio, static fn ($a, $b) => (int) ($b['tbr'] ?? 0) - (int) ($a['tbr'] ?? 0));
    $audio = array_slice($audio, 0, 4);

    $d = (int) ($data['duration'] ?? 0);
    return [
        'ok'        => true,
        'id'        => (string) $data['id'],
        'title'     => (string) ($data['title'] ?? 'untitled'),
        'channel'   => (string) ($data['channel'] ?? $data['uploader'] ?? 'unknown'),
        'duration'  => $d,
        'durationTxt' => $d > 0 ? gmdate('H:i:s', $d) : '--:--',
        'thumb'     => (string) (($data['thumbnail'] ?? '') ?: ''),
        'views'     => (int) ($data['view_count'] ?? 0),
        'audio'     => array_map(static fn ($f) => [
            'ext' => (string) ($f['ext'] ?? '?'),
            'abr' => (int) ($f['abr'] ?? 0),
            'tbr' => (int) ($f['tbr'] ?? 0),
            'note'=> (string) ($f['format_note'] ?? ''),
        ], $audio),
    ];
}

/* ------------------------------------------------------------------ */
/* Info via pure PHP (LEGACY engine)                                   */
/* ------------------------------------------------------------------ */

function info_fallback(string $id): array
{
    $html = http_get(canonical_url($id), 45);
    if ($html === null) {
        return ['ok' => false, 'error' => 'could not reach youtube.com'];
    }

    $json = null;
    if (preg_match('/ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*(?:<\/script>|var\s)/s', $html, $m)
        || preg_match('/ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*<\/script>/s', $html, $m)
        || preg_match('/window\["ytInitialPlayerResponse"\]\s*=\s*(\{.*?\});/s', $html, $m)) {
        $json = json_decode($m[1], true);
    }

    if (!is_array($json) || !isset($json['videoDetails'])) {
        return ['ok' => false, 'error' => 'could not extract player response (legacy engine). Install yt-dlp for reliable info.'];
    }

    $vd = $json['videoDetails'];
    $d  = (int) ($vd['lengthSeconds'] ?? 0);
    return [
        'ok'        => true,
        'id'        => $id,
        'title'     => (string) ($vd['title'] ?? 'untitled'),
        'channel'   => (string) ($vd['author'] ?? 'unknown'),
        'duration'  => $d,
        'durationTxt' => $d > 0 ? gmdate('H:i:s', $d) : '--:--',
        'thumb'     => (string) (($vd['thumbnail']['thumbnails'][0]['url'] ?? '') ?: ''),
        'views'     => (int) ($vd['viewCount'] ?? 0),
        'audio'     => [],
    ];
}

/* ------------------------------------------------------------------ */
/* Convert — streaming NDJSON                                          */
/* ------------------------------------------------------------------ */

function stream_line(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_SLASHES) . "\n";
    if (ob_get_level()) {
        ob_flush();
    }
    flush();
}

function convert_with_ytdlp(string $id, string $quality): void
{
    $bin  = find_bin('yt-dlp');
    $out  = OUT_DIR . '/%(title)s.%(ext)s';
    $args = [
        $bin,
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--no-mtime',
        '--no-check-certificate',
        '-o', $out,
    ];

    if ($quality === 'source') {
        $args[] = '-f'; $args[] = 'bestaudio/best';
    } else {
        // MP3 via ffmpeg at the chosen kbps (64/128/192/320)
        $args[] = '-f';        $args[] = 'bestaudio/best';
        $args[] = '-x';
        $args[] = '--audio-format';  $args[] = 'mp3';
        $args[] = '--audio-quality'; $args[] = $quality . 'K';
    }
    $args[] = canonical_url($id);

    $proc = proc_open($args, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($proc)) {
        stream_line(['type' => 'error', 'message' => 'could not start yt-dlp']);
        return;
    }
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);

    $phase = 'GRABBING';
    $lastPct = 0;
    $buffer = '';
    $start  = microtime(true);
    $destFile = null;

    while (true) {
        $status = proc_get_status($proc);
        $chunk  = '';
        if (!feof($pipes[1])) {
            $chunk .= (string) fread($pipes[1], 4096);
        }
        if (!feof($pipes[2])) {
            $chunk .= (string) fread($pipes[2], 4096);
        }
        $buffer .= $chunk;

        while (($nl = strpos($buffer, "\n")) !== false) {
            $line = substr($buffer, 0, $nl);
            $buffer = substr($buffer, $nl + 1);
            $trimmed = trim($line);
            if ($trimmed === '') {
                continue;
            }
            if (preg_match('/\[ExtractAudio\]|\[ffmpeg\]|\[Merger\]|\[VideoConvertor\]/', $trimmed)) {
                $phase = 'TRANSCODING';
            }
            if (preg_match('/\[(?:download|ExtractAudio)\]\s+Destination:\s*(.+)$/', $trimmed, $dm)) {
                $destFile = trim($dm[1], " \t\"'");
            }
            if (preg_match('/(\d+(?:\.\d+)?)%/', $trimmed, $pm)) {
                $lastPct = min(99, (int) round((float) $pm[1]));
                stream_line(['type' => 'progress', 'pct' => $lastPct, 'phase' => $phase, 'line' => $trimmed]);
            } else {
                stream_line(['type' => 'log', 'phase' => $phase, 'line' => $trimmed]);
            }
        }

        if ($status['running'] === false && $buffer === '') {
            break;
        }
        if (microtime(true) - $start > 900) {
            proc_terminate($proc);
            stream_line(['type' => 'error', 'message' => 'timed out after 15 min']);
            return;
        }
        usleep(50000);
    }
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($proc);

    // locate the produced file (title-named now — trust yt-dlp's Destination line)
    $found = null;
    if ($destFile !== null && is_file($destFile)) {
        $found = $destFile;
    } else {
        foreach (glob(OUT_DIR . '/*.{mp3,m4a,opus,webm,ogg}', GLOB_BRACE) ?: [] as $f) {
            if (str_ends_with($f, '.part') || str_ends_with($f, '.ytdl')) {
                continue;
            }
            if ($found === null || filemtime($f) > filemtime($found)) {
                $found = $f;
            }
        }
    }

    if ($exitCode !== 0 || $found === null) {
        stream_line(['type' => 'error', 'message' => 'conversion failed (exit ' . $exitCode . '). Install yt-dlp + ffmpeg next to api.php for full quality.']);
        return;
    }

    $ext = strtolower(pathinfo($found, PATHINFO_EXTENSION));
    stream_line([
        'type'   => 'done',
        'file'   => basename($found),
        'ext'    => $ext,
        'size'   => filesize($found),
        'sizeTxt'=> human_size((int) filesize($found)),
        'kbps'   => $quality === 'source' ? 'SOURCE' : $quality . 'k',
        'note'   => $quality === 'source' && $ext !== 'mp3' ? 'native stream — not converted (install ffmpeg for MP3)' : null,
    ]);
}

/** LEGACY fallback: best-effort direct-audio-stream download. */
function convert_fallback(string $id): void
{
    $info = info_fallback($id);
    if (!$info['ok']) {
        stream_line(['type' => 'error', 'message' => $info['error']]);
        return;
    }

    $html = http_get(canonical_url($id), 25);
    if ($html === null) {
        stream_line(['type' => 'error', 'message' => 'could not reach youtube.com']);
        return;
    }
    if (!preg_match('/ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*(?:<\/script>|var\s)/s', $html, $m)
        && !preg_match('/ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*<\/script>/s', $html, $m)) {
        stream_line(['type' => 'error', 'message' => 'could not extract player response']);
        return;
    }
    $json = json_decode($m[1], true);
    $formats = $json['streamingData']['adaptiveFormats'] ?? [];
    $pick = null;
    foreach ($formats as $f) {
        if (is_array($f) && str_starts_with((string) ($f['mimeType'] ?? ''), 'audio/') && !empty($f['url'])) {
            $pick = $f;
            break;
        }
    }
    if ($pick === null) {
        stream_line(['type' => 'error', 'message' => 'no direct audio URL exposed (signature-protected). Install yt-dlp to bypass.']);
        return;
    }

    $url   = (string) $pick['url'];
    $ext   = 'm4a';
    if (str_contains((string) ($pick['mimeType'] ?? ''), 'opus')) $ext = 'opus';
    elseif (str_contains((string) ($pick['mimeType'] ?? ''), 'webm')) $ext = 'webm';
    $dest  = OUT_DIR . '/' . $id . '.' . $ext;
    $title = safe_name((string) ($info['title'] ?? 'track'));

    $ch = curl_init($url);
    $fp = fopen($dest, 'wb');
    if (!$fp) {
        stream_line(['type' => 'error', 'message' => 'cannot write to data/out/']);
        return;
    }
    $total = 0;
    curl_setopt_array($ch, [
        CURLOPT_FILE        => $fp,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT     => 900,
        CURLOPT_USERAGENT   => USER_AGENT,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_NOPROGRESS  => false,
        CURLOPT_PROGRESSFUNCTION => static function ($ch, $dl, $dltotal, $ul, $ultotal) {
            stream_line(['type' => 'progress', 'pct' => $dltotal > 0 ? (int) round(($dl / $dltotal) * 100) : 0, 'phase' => 'GRABBING']);
            return 0;
        },
    ]);
    curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fp);

    if ($err !== '' || !is_file($dest) || filesize($dest) < 1000) {
        @unlink($dest);
        stream_line(['type' => 'error', 'message' => 'download failed: ' . ($err ?: 'empty file')]);
        return;
    }

    stream_line([
        'type'   => 'done',
        'file'   => basename($dest),
        'ext'    => $ext,
        'size'   => filesize($dest),
        'sizeTxt'=> human_size((int) filesize($dest)),
        'kbps'   => 'SOURCE',
        'note'   => 'native stream via LEGACY engine — install yt-dlp + ffmpeg for MP3 quality',
    ]);
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

$action = (string) ($_GET['action'] ?? '');
ensure_dirs();

switch ($action) {
    case 'status':
        out(engine_status());
        break;

    case 'info': {
        set_time_limit(120); // slow networks: fetch alone can take 30-60s
        $id = extract_video_id((string) ($_GET['url'] ?? ''));
        if ($id === null || !preg_match(YT_ID_RE, $id)) {
            fail('not a valid YouTube link. Accepts youtube.com/watch, youtu.be, /shorts/, /embed/.');
        }
        if (node_alive()) {
            $res = node_get('/info?url=' . urlencode(canonical_url($id)), 110);
            if ($res === null) {
                fail('node engine could not resolve this video', 422);
            }
            $res['engine'] = 'node';
            out($res);
            break;
        }
        $bin = find_bin('yt-dlp');
        $res = $bin ? info_with_ytdlp($id) : info_fallback($id);
        if (!$res['ok']) {
            fail($res['error'], 422);
        }
        $res['engine'] = $bin ? 'yt-dlp' : 'legacy';
        out($res);
        break;
    }

    case 'convert': {
        set_time_limit(0); // streaming conversion may run long
        $rawUrl = (string) ($_POST['url'] ?? $_GET['url'] ?? '');
        $quality = (string) ($_POST['quality'] ?? '128');
        if (!in_array($quality, ['64', '128', '192', '320', 'source'], true)) {
            fail('quality must be 64, 128, 192, 320 or source');
        }
        $id = extract_video_id($rawUrl);
        if ($id === null || !preg_match(YT_ID_RE, $id)) {
            fail('not a valid YouTube link.');
        }

        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no');

        $st = engine_status();
        $ytdlp = find_bin('yt-dlp');
        if ($quality !== 'source' && !node_alive() && (!$ytdlp || !find_bin('ffmpeg'))) {
            stream_line(['type' => 'start', 'id' => $id, 'quality' => $quality]);
            stream_line(['type' => 'error', 'message' => 'MP3 conversion needs the node engine (node server.js) OR yt-dlp + ffmpeg. Current engine: ' . $st['engine'] . '. Use quality=source.']);
            exit;
        }

        if (node_alive()) {
            // Node emits its own 'start' line — stream it straight through.
            // Stream the Node engine's NDJSON straight through.
            $payload = json_encode(['url' => canonical_url($id), 'quality' => $quality], JSON_UNESCAPED_SLASHES);
            $ctx = stream_context_create(['http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\nContent-Length: " . strlen($payload),
                'content' => $payload,
                'timeout' => 3600,
            ]]);
            $fp = @fopen(NODE_URL . '/convert', 'r', false, $ctx);
            if ($fp === false) {
                stream_line(['type' => 'error', 'message' => 'node engine unreachable']);
                exit;
            }
            $status = (int) (($http_response_header[0] ?? '') === '' ? 200 : (int) substr($http_response_header[0] ?? 'HTTP/1.1 500', 9, 3));
            if ($status === 409) {
                $body = (string) stream_get_contents($fp);
                fclose($fp);
                $j = json_decode($body, true);
                stream_line(['type' => 'error', 'message' => $j['error'] ?? 'engine busy']);
                exit;
            }
            while (!feof($fp)) {
                $line = fgets($fp, 4096);
                if ($line === false) {
                    break;
                }
                echo $line;
                if (ob_get_level()) {
                    ob_flush();
                }
                flush();
            }
            fclose($fp);
            exit;
        }

        stream_line(['type' => 'start', 'id' => $id, 'quality' => $quality]);
        if ($ytdlp) {
            convert_with_ytdlp($id, $quality);
        } else {
            convert_fallback($id);
        }
        exit;
    }

    case 'download': {
        $file = basename((string) ($_GET['file'] ?? ''));
        if ($file === '' || $file !== (string) basename($file) || str_contains($file, '/') || str_contains($file, '\\')) {
            fail('invalid file name');
        }
        $path = OUT_DIR . '/' . $file;
        if (!is_file($path)) {
            fail('file not found', 404);
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $ct  = match ($ext) {
            'mp3'  => 'audio/mpeg',
            'm4a'  => 'audio/mp4',
            'opus' => 'audio/ogg',
            'webm' => 'audio/webm',
            'ogg'  => 'audio/ogg',
            default => 'application/octet-stream',
        };
        header('Content-Type: ' . $ct);
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . $file . '"');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    default:
        out(engine_status() + ['endpoints' => ['status', 'info', 'convert', 'download']]);
}
