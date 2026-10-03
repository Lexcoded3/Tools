<?php
/**
 * PixelForge API — pure PHP backend, zero dependencies.
 *
 * Powers the PixelForge AI image studio. It talks to the free Perchance
 * image-generation service using browser-style HTTP headers, so no API key,
 * no signup and no CAPTCHA are needed (keys are issued tokenlessly per
 * session and cached locally).
 *
 * Endpoints (all GET/POST to api.php):
 *   action=status       -> service + key health check
 *   action=generate     -> create an image (form fields: prompt, negative,
 *                           style, resolution, guidance, seed). resolution
 *                           is square/portrait/landscape or custom (with
 *                           res_w/res_h; snapped to 64px steps in 256-768,
 *                           auto-retried at a supported size if rejected).
 *                           With a reference: engine=free runs keyless
 *                           Perchance img2img (referenceImage), engine=ai
 *                           runs real img2img via the user's HuggingFace token.
 *   action=repaint_save -> save a browser-rendered local repaint (image
 *                           data URL + style + blend) into history
 *   action=hfkey        -> save/clear the HuggingFace token for AI repaint
 *   action=upload3d     -> save a browser-rendered 3D parallax WebM (body =
 *                           video blob, GET mode/aspect/title) into history
 *   action=history      -> list saved generations (newest first)
 *   action=delete       -> remove a saved generation (id)
 *   action=download     -> force-download a saved image (id)
 *   action=verify       -> re-hash a saved file and confirm it is intact (id)
 */
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('default_socket_timeout', '180');
set_time_limit(600); // batches generate one image per request; keep the server patient


header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Guards the secrets file (../../pixelforge.secrets.php — two folders up,
// kept at the project root while the studio lives under Tools/) against
// direct HTTP access: it refuses to run (403, no output) unless required
// from this file.
define('PIXELFORGE_SECRETS', true);

const BASE        = 'https://image-generation.perchance.org';
/** Text-generation host — powers the prompt enhancer (ai-text-plugin API). */
const TEXT_BASE   = 'https://text-generation.perchance.org';
const UA          = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const DATA_DIR    = __DIR__ . '/data';
const IMG_DIR     = DATA_DIR . '/images';
const VIDEO_DIR   = DATA_DIR . '/videos';
const TTS_DIR     = DATA_DIR . '/tts';
const KEY_FILE    = DATA_DIR . '/key.json';
const HISTORY_FILE = DATA_DIR . '/history.json';
const VIDEO_CONFIG_FILE = DATA_DIR . '/config.json';
const BUSY_FILE   = DATA_DIR . '/busy.json'; // free-engine load state (see mark_service_load)
const REF_CACHE_FILE = DATA_DIR . '/refcache.json'; // data-URL -> public-URL relay cache (see publish_reference)
/**
 * Local secrets file — deliberately placed OUTSIDE the project folder (one
 * level up) so API keys are never inside the web-accessible project tree.
 */
const SECRETS_FILE = __DIR__ . '/../../pixelforge.secrets.php';

/** Style presets: human name => [positive suffix, negative suffix]. */
const STYLES = [
    'none'        => ['', ''],
    'photoreal'   => ['photorealistic, professional photography, 8k, sharp focus, highly detailed',
                      'cartoon, anime, painting, sketch, 3d render, low quality'],
    'anime'       => ['anime style, vibrant colors, detailed anime art, masterpiece, high quality',
                      'photorealistic, 3d render, blurry, low quality'],
    'oil'         => ['oil painting, impasto brushstrokes, classical art style, textured canvas',
                      'photorealistic, digital art, cartoon'],
    'watercolor'  => ['watercolor painting, soft washes, delicate brushwork, artistic, paper texture',
                      'photorealistic, harsh edges, digital'],
    '3d'          => ['3d render, octane render, cinematic lighting, high detail, depth of field',
                      'flat, 2d, cartoon, blurry'],
    'cyberpunk'   => ['cyberpunk aesthetic, neon lights, futuristic city, cinematic, dramatic',
                      'rural, daytime, low quality, dull colors'],
    'fantasy'     => ['epic fantasy art, dramatic lighting, highly detailed, concept art, majestic',
                      'modern city, photorealistic, low detail'],
    'pixel'       => ['pixel art, 8-bit style, retro video game, crisp pixels, limited palette',
                      '3d, photorealistic, blurry, high detail'],
    'sketch'      => ['pencil sketch, hand-drawn, black and white, detailed shading, line art',
                      'color, photorealistic, painting'],
    'minimal'     => ['minimalist, clean composition, simple background, elegant, negative space',
                      'cluttered, busy, complex, text'],
    'cartoon'     => ['cartoon style, bold outlines, flat vibrant colors, playful',
                      'photorealistic, dark, gritty, 3d render'],
];

/** Display labels for the tuned suffix styles (shown in the dropdown). */
const STYLE_LABELS = [
    'none'       => 'No style',
    'photoreal'  => 'Photo',
    'anime'      => 'Anime',
    'oil'        => 'Oil Paint',
    'watercolor' => 'Watercolor',
    '3d'         => '3D Render',
    'cyberpunk'  => 'Cyberpunk',
    'fantasy'    => 'Fantasy',
    'pixel'      => 'Pixel Art',
    'sketch'     => 'Sketch',
    'minimal'    => 'Minimal',
    'cartoon'    => 'Cartoon',
];

/**
 * Neutral anti-stylization negative, merged into every "No style" generation.
 *
 * "No style" sends the user's prompt 100% untouched, but the free service's
 * default model leans stylized (anime / illustration) for human figures, so a
 * bare prompt with an empty negative prompt comes back anime-like. This block
 * suppresses that tendency without adding any style words to the positive
 * prompt. The user's own negative tokens are always kept and merged first, and
 * the Anime style (which ships its own negative) is never affected.
 */
const BASE_NEGATIVE = 'cartoon, anime, illustration, drawing, painting, sketch, 3d render, cgi, render, ' .
    'low quality, worst quality, blurry, deformed, bad anatomy, extra fingers, fused fingers, ' .
    'malformed hands, distorted face, watermark, text';

/** Standard resolutions offered in the UI. */
const RESOLUTIONS = [
    'square'    => ['Square', '768x768'],
    'portrait'  => ['Portrait', '512x768'],
    'landscape' => ['Landscape', '768x512'],
];

/* ------------------------------------------------------------------ */
/* Style templates (Perchance presets, loaded from styles.json)         */
/* ------------------------------------------------------------------ */

/** Load the Perchance-style prompt templates (each with a {{DESC}} token). */
function load_style_templates(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $file = __DIR__ . '/styles.json';
    if (!is_file($file)) {
        return $cache = [];
    }
    $data  = json_decode((string) file_get_contents($file), true);
    $cache = is_array($data) ? $data : [];
    return $cache;
}

/** Render a Perchance-style prompt template with the user's description. */
function render_style_template(string $template, string $desc): string
{
    $out = str_replace(
        ['{{DESC_REALISTIC}}', '{{PIXEL_PREFIX}}', '{{PIXEL_SUFFIX}}', '{{DESC}}'],
        [
            preg_replace('/\brealistic\b/i', 'actual', $desc),
            mb_strlen($desc) > 40 ? '(pixel art), ' : '',
            mb_strlen($desc) < 10 ? 'of ' . $desc : '',
            $desc,
        ],
        $template
    );
    // If the style template never used a description token, put the user's
    // prompt up front so it still drives the image.
    if (!str_contains($template, '{{DESC') && $desc !== '') {
        $out = $desc . ', ' . $out;
    }
    return trim($out);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function api_out(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function api_error(string $message, int $code = 400): void
{
    api_out(['ok' => false, 'error' => $message], $code);
}

function ensure_dirs(): void
{
    if (!is_dir(IMG_DIR)) {
        mkdir(IMG_DIR, 0775, true);
    }
    if (!is_dir(VIDEO_DIR)) {
        mkdir(VIDEO_DIR, 0775, true);
    }
    if (!is_dir(TTS_DIR)) {
        mkdir(TTS_DIR, 0775, true);
    }
}

/* ------------------------------------------------------------------ */
/* Video mode (Replicate text-to-video)                                */
/* ------------------------------------------------------------------ */

/**
 * Read API keys from the secrets store — never from inside the web root.
 *
 * Precedence:
 *   1. Environment variables (PIXELFORGE_REPLICATE_KEY / PIXELFORGE_HF_KEY)
 *      — ideal for production/CI where keys live in the process environment.
 *   2. The local secrets PHP file one folder above the project
 *      (pixelforge.secrets.php). It is executed server-side and outputs
 *      nothing unless included from api.php, so its contents can never be
 *      downloaded even if the parent folder is under the web root.
 *   3. Legacy data/config.json — old installs that still carry keys there are
 *      still read (migration back-compat), but keys are never written there
 *      anymore.
 */
function load_secrets(): array
{
    $keys = [
        'replicate_key'   => trim((string) getenv('PIXELFORGE_REPLICATE_KEY')),
        'pollinations_key'=> trim((string) getenv('PIXELFORGE_POLLINATIONS_KEY')),
        'hf_key'          => trim((string) getenv('PIXELFORGE_HF_KEY')),
    ];

    if (is_file(SECRETS_FILE)) {
        $data = require SECRETS_FILE;
        if (is_array($data)) {
            foreach (['replicate_key', 'pollinations_key', 'hf_key'] as $k) {
                if ($keys[$k] === '' && !empty($data[$k])) {
                    $keys[$k] = (string) $data[$k];
                }
            }
        }
    }

    // Legacy back-compat: read (but never write) keys from data/config.json.
    $raw = is_file(VIDEO_CONFIG_FILE) ? json_decode((string) file_get_contents(VIDEO_CONFIG_FILE), true) : null;
    if (is_array($raw)) {
        foreach (['replicate_key', 'pollinations_key', 'hf_key'] as $k) {
            if ($keys[$k] === '' && !empty($raw[$k])) {
                $keys[$k] = (string) $raw[$k];
            }
        }
    }

    return $keys;
}

/**
 * Persist an API key into the secrets file outside the web root.
 * Empty values remove the key. Fails loudly rather than falling back to
 * data/config.json — keys must never land back in the web-accessible tree.
 */
function save_secret(string $key, string $value): void
{
    if (!in_array($key, ['replicate_key', 'pollinations_key', 'hf_key'], true)) {
        api_error('Unknown secret key.', 400);
    }

    $secrets = [];
    if (is_file(SECRETS_FILE)) {
        $data = require SECRETS_FILE;
        if (!is_array($data)) {
            // Refuse to blindly overwrite a hand-edited/corrupt file — that
            // could silently wipe the other stored key.
            api_error(
                'The secrets file is corrupt (did not return an array). Fix or delete ' .
                basename(SECRETS_FILE) . ', then try again.',
                500
            );
        }
        $secrets = $data;
    }
    $secrets[$key] = $value;
    if (($secrets['replicate_key'] ?? '') === '') {
        unset($secrets['replicate_key']);
    }
    if (($secrets['pollinations_key'] ?? '') === '') {
        unset($secrets['pollinations_key']);
    }
    if (($secrets['hf_key'] ?? '') === '') {
        unset($secrets['hf_key']);
    }

    $php = "<?php\n"
        . "// PixelForge API secrets — stored outside the project web folder on purpose.\n"
        . "// Never move this file into the web root, and never commit it to git.\n"
        . "// Set the PIXELFORGE_REPLICATE_KEY / PIXELFORGE_POLLINATIONS_KEY /\n"
        . "// PIXELFORGE_HF_KEY environment variables to override these values.\n"
        . "if (!defined('PIXELFORGE_SECRETS')) { http_response_code(403); exit; }\n"
        . 'return ' . var_export($secrets, true) . ";\n";

    // Atomic write (temp file + rename): a crash mid-write can never leave a
    // truncated file behind, which would be a PHP fatal on the next require.
    $tmp = SECRETS_FILE . '.tmp';
    if (@file_put_contents($tmp, $php) === false) {
        api_error(
            'Could not write ' . basename(SECRETS_FILE) . ' next to the project folder ' .
            '(check permissions on ' . dirname(SECRETS_FILE) . '). ' .
            'Alternatively set the PIXELFORGE_' . strtoupper($key) . ' environment variable.',
            500
        );
    }
    if (!@rename($tmp, SECRETS_FILE) && @file_put_contents(SECRETS_FILE, $php) === false) {
        @unlink($tmp);
        api_error(
            'Could not write ' . basename(SECRETS_FILE) . ' next to the project folder ' .
            '(check permissions on ' . dirname(SECRETS_FILE) . '). ' .
            'Alternatively set the PIXELFORGE_' . strtoupper($key) . ' environment variable.',
            500
        );
    }
}

/**
 * Full video/repaint config: model settings from data/config.json, API keys
 * resolved through load_secrets() (env var / secrets file / legacy config).
 */
function load_video_config(): array
{
    $config = [
        'video_model' => 'minimax/video-01',
        'hf_model'    => 'Lykon/dreamshaper-xl-1-0',
    ];
    if (is_file(VIDEO_CONFIG_FILE)) {
        $data = json_decode((string) file_get_contents(VIDEO_CONFIG_FILE), true);
        if (is_array($data)) {
            $config['video_model'] = (string) ($data['video_model'] ?? $config['video_model']);
            $config['hf_model']    = (string) ($data['hf_model'] ?? $config['hf_model']);
        }
    }
    $keys = load_secrets();
    return [
        'replicate_key' => $keys['replicate_key'],
        'video_model'   => $config['video_model'],
        'hf_key'        => $keys['hf_key'],
        'hf_model'      => $config['hf_model'],
    ];
}

/** Persist non-secret model settings to data/config.json (keys live elsewhere). */
function save_video_config(array $config): void
{
    ensure_dirs();
    file_put_contents(VIDEO_CONFIG_FILE, json_encode([
        'video_model' => (string) ($config['video_model'] ?? 'minimax/video-01'),
        'hf_model'    => (string) ($config['hf_model'] ?? 'Lykon/dreamshaper-xl-1-0'),
    ], JSON_PRETTY_PRINT));
}

/** Authenticated JSON call to the Replicate API. */
function replicate_request(string $method, string $url, array $body, string $key): array
{
    if (!function_exists('curl_init')) {
        return ['code' => 0, 'error' => 'PHP curl is not enabled.'];
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $key,
            'Content-Type: application/json',
            'User-Agent: PixelForge/1.0',
        ],
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $raw  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return ['code' => 0, 'error' => 'Network error: ' . $err];
    }
    $decoded = json_decode($raw, true);
    return ['code' => $code, 'body' => is_array($decoded) ? $decoded : ['raw' => $raw]];
}

/** Download the finished MP4 and record it in history. */
function finalize_video(string $url, array $in, string $engine = 'replicate'): array
{
    $bin = http_request($url, null, 300);
    return finalize_video_bytes($bin, $in, $engine);
}

/**
 * Validate finished MP4 bytes, save them into data/videos/ and record the
 * entry in history. Shared by the Replicate, Pollinations and Okatsu paths.
 */
function finalize_video_bytes(string $bin, array $in, string $engine): array
{
    ensure_dirs();
    if (strlen($bin) < 2000) {
        api_error('The rendered video download failed (file too small).', 502);
    }
    // Integrity: MP4 files start with an 'ftyp' box — refuse to save junk.
    if (substr($bin, 4, 4) !== 'ftyp') {
        api_error('The rendered video is not a valid MP4 — nothing was saved.', 502);
    }
    $hash = hash('sha256', $bin);

    $id   = date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
    $file = $id . '.mp4';
    file_put_contents(VIDEO_DIR . '/' . $file, $bin);

    $entry = [
        'id'         => $id,
        'type'       => 'video',
        'file'       => $file,
        'hash'       => $hash,
        'prompt'     => $in['prompt'],
        'prompt_orig'=> $in['prompt'],
        'style'      => $in['style'],
        'seed'       => 0,
        'resolution' => '16:9',
        'engine'     => $engine,
        'created'    => date('c'),
    ];

    $history = load_history();
    array_unshift($history, $entry);
    save_history(array_slice($history, 0, 500));

    return ['ok' => true, 'entry' => $entry, 'url' => 'data/videos/' . rawurlencode($file)];
}

function random_float(): float
{
    return mt_rand() / mt_getrandmax();
}

/* ------------------------------------------------------------------ */
/* Story mode: free TTS (edge-tts + gTTS fallback) + story video       */
/* ------------------------------------------------------------------ */

const EDGE_TC_TOKEN  = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=' . EDGE_TC_TOKEN;
const EDGE_WS_HOST   = 'speech.platform.bing.com';
const EDGE_WS_PATH   = '/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_CHROMIUM  = '143.0.3650.75';

/** Plain HTTP GET/POST with custom headers (for the Bing/Edge endpoints). */
function http_get_text(string $url, array $headers = [], int $timeout = 30, bool $post = false): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT      => UA,
        ];
        if ($post) {
            $opts[CURLOPT_POST] = true;
        }
        curl_setopt_array($ch, $opts);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return is_string($body) && $code < 400 ? $body : '';
    }
    $ctx = stream_context_create(['http' => [
        'method'        => $post ? 'POST' : 'GET',
        'timeout'       => $timeout,
        'header'        => implode("\r\n", $headers),
        'ignore_errors' => true,
        'user_agent'    => UA,
    ]]);
    return (string) @file_get_contents($url, false, $ctx);
}

/**
 * Sec-MS-GEC value for the Edge read-aloud service (2026 algorithm).
 * Windows file time rounded to 5 minutes, concatenated with the trusted
 * client token, SHA-256'd and uppercased.
 */
function edge_sec_ms_gec(): string
{
    $t = time() + 11644473600;   // unix -> Windows file-time epoch
    $t -= $t % 300;              // round down to 5 minutes
    $t *= 10000000;              // seconds -> 100-ns ticks
    return strtoupper(hash('sha256', (string) $t . EDGE_TC_TOKEN));
}

/** Random 32-hex MUID cookie value. */
function edge_muid(): string
{
    return strtoupper(bin2hex(random_bytes(16)));
}

/** JS-style date string used in service messages. */
function edge_date_string(): string
{
    return gmdate('D M d Y H:i:s') . ' GMT+0000 (Coordinated Universal Time)';
}

/** Open a WebSocket connection (RFC 6455 client, masked frames). */
function ws_connect(string $host, string $path, array $extraHeaders): mixed
{
    $fp = @stream_socket_client(
        'ssl://' . $host . ':443',
        $errno, $errstr, 25,
        STREAM_CLIENT_CONNECT,
        stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]])
    );
    if (!$fp) {
        error_log('ws_connect socket fail: ' . $errno . ' ' . $errstr);
        return null;
    }
    $key  = base64_encode(random_bytes(16));
    $head = "GET $path HTTP/1.1\r\n"
        . "Host: $host\r\n"
        . "Upgrade: websocket\r\n"
        . "Connection: Upgrade\r\n"
        . "Sec-WebSocket-Key: $key\r\n"
        . "Sec-WebSocket-Version: 13\r\n"
        . implode("\r\n", $extraHeaders)
        . "\r\n\r\n";
    fwrite($fp, $head);
    stream_set_timeout($fp, 25);
    $resp = '';
    while (!feof($fp) && !str_contains($resp, "\r\n\r\n")) {
        $chunk = fread($fp, 8192);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $resp .= $chunk;
        if (strlen($resp) > 65536) {
            break;
        }
    }
    if (!str_contains($resp, ' 101 ')) {
        error_log('ws_connect handshake fail: ' . substr($resp, 0, 200));
        fclose($fp);
        return null;
    }
    return $fp;
}

/** Send a masked client frame. */
function ws_send(mixed $fp, string $payload, int $opcode = 0x1): void
{
    $len  = strlen($payload);
    $mask = random_bytes(4);
    $head = chr(0x80 | $opcode);
    if ($len < 126) {
        $head .= chr(0x80 | $len);
    } elseif ($len < 65536) {
        $head .= chr(0x80 | 126) . pack('n', $len);
    } else {
        $head .= chr(0x80 | 127) . pack('J', $len);
    }
    $masked = '';
    for ($i = 0; $i < $len; $i++) {
        $masked .= $payload[$i] ^ $mask[$i % 4];
    }
    fwrite($fp, $head . $mask . $masked);
}

/** Read one server frame (server frames are unmasked). */
function ws_read(mixed $fp): ?array
{
    stream_set_timeout($fp, 25);
    $hdr = fread($fp, 2);
    if ($hdr === false || strlen($hdr) < 2) {
        return null;
    }
    $b0    = ord($hdr[0]);
    $b1    = ord($hdr[1]);
    $opcode = $b0 & 0x0F;
    $len    = $b1 & 0x7F;
    $masked = ($b1 & 0x80) !== 0;
    if ($len === 126) {
        $ext = fread($fp, 2);
        if (strlen($ext) < 2) {
            return null;
        }
        $len = unpack('n', $ext)[1];
    } elseif ($len === 127) {
        $ext = fread($fp, 8);
        if (strlen($ext) < 8) {
            return null;
        }
        $len = unpack('J', $ext)[1];
    }
    $maskKey = '';
    if ($masked) {
        $maskKey = fread($fp, 4);
        if (strlen($maskKey) < 4) {
            return null;
        }
    }
    $payload = '';
    while (strlen($payload) < $len) {
        $chunk = fread($fp, min(16384, $len - strlen($payload)));
        if ($chunk === false || $chunk === '') {
            break;
        }
        $payload .= $chunk;
    }
    if ($masked && $maskKey !== '') {
        $unmasked = '';
        $plen = strlen($payload);
        for ($i = 0; $i < $plen; $i++) {
            $unmasked .= $payload[$i] ^ $maskKey[$i % 4];
        }
        $payload = $unmasked;
    }
    return ['opcode' => $opcode, 'payload' => $payload];
}

/**
 * Synthesize speech via the Edge read-aloud WebSocket service (2026 flow).
 * The service no longer uses a token endpoint: Sec-MS-GEC is passed as a
 * query parameter on the WSS URL and a random muid cookie is used instead
 * of an Authorization header.
 * Returns raw MP3 bytes, or null on failure.
 */
function edge_tts_speak(string $text, string $voice, string $rate, string $pitch, string $lang): ?string
{
    $gec = edge_sec_ms_gec();
    $connId = bin2hex(random_bytes(16));

    $path = EDGE_WS_PATH
        . '?TrustedClientToken=' . EDGE_TC_TOKEN
        . '&ConnectionId=' . $connId
        . '&Sec-MS-GEC=' . $gec
        . '&Sec-MS-GEC-Version=1-' . EDGE_CHROMIUM;

    $headers = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' . EDGE_CHROMIUM . ' Safari/537.36 Edg/' . EDGE_CHROMIUM,
        'Accept-Encoding: gzip, deflate, br, zstd',
        'Accept-Language: en-US,en;q=0.9',
        'Pragma: no-cache',
        'Cache-Control: no-cache',
        'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits',
        'Cookie: muid=' . edge_muid() . ';',
    ];

    $fp = ws_connect(EDGE_WS_HOST, $path, $headers);
    if ($fp === null) {
        return null;
    }

    $ts = edge_date_string();

    // Speech config first (sentenceBoundaryEnabled must be true).
    $config = "X-Timestamp:$ts\r\n"
        . "Content-Type:application/json; charset=utf-8\r\n"
        . "Path:speech.config\r\n\r\n"
        . '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}' . "\r\n";
    ws_send($fp, $config);

    // SSML request. X-RequestId must be a no-dash UUID (32 hex chars).
    $uuid = bin2hex(random_bytes(16));
    $escaped = htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $fullVoice = edge_full_voice($voice);
    $ssml = "X-RequestId:$uuid\r\n"
        . "Content-Type:application/ssml+xml\r\n"
        . "X-Timestamp:{$ts}Z\r\n"
        . "Path:ssml\r\n\r\n"
        . "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='$fullVoice'><prosody pitch='$pitch' rate='$rate' volume='+0%'>$escaped</prosody></voice></speak>";
    ws_send($fp, $ssml);

    // Collect audio until turn.end.
    $audio = '';
    $started = time();
    while (time() - $started < 90) {
        $frame = ws_read($fp);
        if ($frame === null) {
            break;
        }
        $op = $frame['opcode'];
        if ($op === 0x2) {
            // Binary audio frame: header text first, MP3 data after the
            // first 0xFF byte (header is pure ASCII, so 0xFF never appears
            // before the actual audio).
            $p = $frame['payload'];
            $pos = strpos($p, "\xFF");
            if ($pos !== false && $pos < strlen($p) - 1) {
                $audio .= substr($p, $pos);
            }
        } elseif ($op === 0x1) {
            $msg = $frame['payload'];
            if (str_contains($msg, 'Path:turn.end')) {
                break;
            }
        } elseif ($op === 0x8) {
            break; // close
        } elseif ($op === 0x9) {
            ws_send($fp, '', 0xA); // pong
        }
    }
    fclose($fp);
    return $audio !== '' ? $audio : null;
}

/** Fallback: Google Translate TTS (gTTS) — free, keyless, no WS needed. */
function gtts_speak(string $text, string $lang): ?string
{
    $lang = preg_replace('/[^a-z\-]/i', '', $lang);
    if ($lang === '' || $lang === '-') {
        $lang = 'en';
    }
    $text = mb_substr($text, 0, 200);
    $url  = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' . urlencode($lang) . '&q=' . urlencode($text);
    $bin  = http_get_text($url, ['Referer: https://translate.google.com/', 'Accept: audio/mpeg'], 30);
    if (strlen($bin) < 1000 || str_starts_with(ltrim($bin), '<')) {
        return null;
    }
    return $bin;
}

/** Derive xml:lang from a voice ShortName, e.g. en-US-ChristopherNeural -> en-US. */
function voice_lang(string $voice): string
{
    $parts = explode('-', $voice);
    return ($parts[0] ?? 'en') . '-' . ($parts[1] ?? 'US');
}

/**
 * Convert a voice ShortName (en-US-ChristopherNeural) to the full name the
 * Edge service expects inside SSML (Microsoft Server Speech Text to Speech
 * Voice (en-US, ChristopherNeural)). The service rejects short names.
 */
function edge_full_voice(string $voice): string
{
    if (preg_match('/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/', $voice, $m)) {
        $lang   = $m[1];
        $region = $m[2];
        $name   = $m[3];
        $dash   = strpos($name, '-');
        if ($dash !== false) {
            $region .= '-' . substr($name, 0, $dash);
            $name = substr($name, $dash + 1);
        }
        return 'Microsoft Server Speech Text to Speech Voice (' . $lang . '-' . $region . ', ' . $name . ')';
    }
    return $voice;
}

/** Curated fallback voice list (used if the live voice list is unreachable). */
function fallback_voices(): array
{
    return [
        ['voice' => 'en-US-ChristopherNeural',  'name' => 'Christopher · English (US) · Male',    'lang' => 'en-US', 'gender' => 'Male'],
        ['voice' => 'en-US-JennyNeural',        'name' => 'Jenny · English (US) · Female',         'lang' => 'en-US', 'gender' => 'Female'],
        ['voice' => 'en-US-AriaNeural',         'name' => 'Aria · English (US) · Female',          'lang' => 'en-US', 'gender' => 'Female'],
        ['voice' => 'en-US-GuyNeural',          'name' => 'Guy · English (US) · Male',             'lang' => 'en-US', 'gender' => 'Male'],
        ['voice' => 'en-GB-RyanNeural',         'name' => 'Ryan · English (UK) · Male',            'lang' => 'en-GB', 'gender' => 'Male'],
        ['voice' => 'en-GB-SoniaNeural',        'name' => 'Sonia · English (UK) · Female',         'lang' => 'en-GB', 'gender' => 'Female'],
        ['voice' => 'en-AU-WilliamNeural',      'name' => 'William · English (AU) · Male',         'lang' => 'en-AU', 'gender' => 'Male'],
        ['voice' => 'en-KE-AsiliaNeural',       'name' => 'Asilia · English (Kenya) · Female',     'lang' => 'en-KE', 'gender' => 'Female'],
        ['voice' => 'en-KE-ChilembaNeural',     'name' => 'Chilemba · English (Kenya) · Male',     'lang' => 'en-KE', 'gender' => 'Male'],
        ['voice' => 'en-TZ-ImaniNeural',        'name' => 'Imani · English (Tanzania) · Female',   'lang' => 'en-TZ', 'gender' => 'Female'],
        ['voice' => 'en-NG-AbelNeural',         'name' => 'Abel · English (Nigeria) · Male',       'lang' => 'en-NG', 'gender' => 'Male'],
        ['voice' => 'en-ZA-LeahNeural',         'name' => 'Leah · English (South Africa) · Female','lang' => 'en-ZA', 'gender' => 'Female'],
        ['voice' => 'sw-KE-ZuriNeural',         'name' => 'Zuri · Swahili (Kenya) · Female',       'lang' => 'sw-KE', 'gender' => 'Female'],
        ['voice' => 'sw-TZ-RehemaNeural',       'name' => 'Rehema · Swahili (Tanzania) · Female',  'lang' => 'sw-TZ', 'gender' => 'Female'],
        ['voice' => 'fr-FR-DeniseNeural',       'name' => 'Denise · French (France) · Female',     'lang' => 'fr-FR', 'gender' => 'Female'],
        ['voice' => 'fr-FR-HenriNeural',        'name' => 'Henri · French (France) · Male',        'lang' => 'fr-FR', 'gender' => 'Male'],
    ];
}

/** Fetch the live Edge voice list, filtered to useful locales. */
function fetch_edge_voices(): array
{
    $raw  = http_get_text(EDGE_VOICES_URL, ['Accept: application/json'], 30);
    $list = json_decode($raw, true);
    if (!is_array($list)) {
        return [];
    }
    $want = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IE', 'en-IN', 'en-KE', 'en-NG', 'en-ZA', 'en-TZ', 'sw-KE', 'sw-TZ', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR', 'ja-JP', 'zh-CN'];
    $out = [];
    foreach ($list as $v) {
        if (!is_array($v)) {
            continue;
        }
        $short  = (string) ($v['ShortName'] ?? '');
        $locale = strtolower((string) ($v['Locale'] ?? ''));
        if ($short === '') {
            continue;
        }
        $ok = false;
        foreach ($want as $w) {
            if (str_starts_with($locale, strtolower($w))) {
                $ok = true;
                break;
            }
        }
        if (!$ok) {
            continue;
        }
        $out[] = [
            'voice'  => $short,
            'name'   => (string) ($v['FriendlyName'] ?? $short),
            'lang'   => (string) ($v['Locale'] ?? ''),
            'gender' => (string) ($v['Gender'] ?? ''),
        ];
    }
    usort($out, static fn ($a, $b) => strcmp($a['lang'] . $a['voice'], $b['lang'] . $b['voice']));
    return $out;
}

/**
 * Transport layer.
 *
 * Prefers the *system curl binary* (curl.exe on Windows / curl on Linux):
 * Cloudflare whitelists its TLS fingerprint (Schannel / OpenSSL-system), while
 * PHP's bundled libcurl (OpenSSL) sometimes gets a bot-management challenge.
 * Falls back to PHP's curl extension automatically when the binary is missing
 * or disabled.
 */

function looks_like_challenge(string $body): bool
{
    $head = substr($body, 0, 1024);
    return strpos($head, '<!DOCTYPE html') !== false
        || strpos($head, 'Just a moment') !== false
        || stripos($head, 'cf-challenge') !== false
        || strpos($head, 'challenge-platform') !== false;
}

/** Locate the system curl binary (checks PATH + Windows System32). */
function curl_binary(): ?string
{
    static $found = false;
    if ($found !== false) {
        return $found;
    }

    $candidates = PHP_OS_FAMILY === 'Windows' ? ['curl.exe', 'curl'] : ['curl'];
    $path = getenv('PATH') ?: '';

    foreach (explode(PATH_SEPARATOR, $path) as $dir) {
        $dir = trim($dir);
        if ($dir === '') {
            continue;
        }
        foreach ($candidates as $name) {
            $file = rtrim($dir, '\\/') . DIRECTORY_SEPARATOR . $name;
            if (is_file($file) && is_executable($file)) {
                $found = $file;
                return $found;
            }
        }
    }

    if (PHP_OS_FAMILY === 'Windows') {
        $sysRoot = getenv('SystemRoot') ?: 'C:\\Windows';
        $sys32 = $sysRoot . '\\System32\\curl.exe';
        if (is_file($sys32)) {
            $found = $sys32;
            return $found;
        }
    }

    $found = null;
    return $found;
}

/** Run the system curl binary via proc_open (no shell -> no injection risk). */
function binary_curl(string $binary, string $url, ?string $postBody, int $timeout): ?string
{
    if (!function_exists('proc_open')) {
        return null;
    }
    $args = [
        $binary, '-sS',
        '--compressed',
        '--max-time', (string) $timeout,
        '--connect-timeout', '25',
        '-A', UA,
        '-H', 'Accept: */*',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        '-H', 'Origin: ' . BASE,
        '-H', 'Referer: ' . BASE . '/embed',
    ];
    if ($postBody !== null) {
        $args[] = '-X';
        $args[] = 'POST';
        $args[] = '-H';
        $args[] = 'Content-Type: application/json';
        $args[] = '--data-binary';
        $args[] = '@-';
    }
    $args[] = $url;

    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open($args, $descriptors, $pipes);
    if (!is_resource($proc)) {
        return null;
    }
    if ($postBody !== null) {
        fwrite($pipes[0], $postBody);
    }
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);

    if ($stdout === false) {
        return null;
    }
    return $stdout;
}

/** Fallback: PHP's own curl extension. */
function php_curl_request(string $url, ?string $postBody, int $timeout): ?string
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    $headers = [
        'User-Agent: ' . UA,
        'Accept: */*',
        'Accept-Language: en-US,en;q=0.9',
        'Origin: ' . BASE,
        'Referer: ' . BASE . '/embed',
    ];
    if ($postBody !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($postBody !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postBody);
    }
    $body = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        api_error('Network error reaching image service: ' . $error, 502);
    }
    return $body;
}

/** Raw HTTP GET/POST with browser-style headers. */
function http_request(string $url, ?string $postBody = null, int $timeout = 120): string
{
    $binary = curl_binary();
    if ($binary !== null) {
        $out = binary_curl($binary, $url, $postBody, $timeout);
        if ($out !== null && !looks_like_challenge($out)) {
            return $out;
        }
    }

    $out = php_curl_request($url, $postBody, $timeout);
    if ($out === null) {
        api_error('This server cannot reach the image service (no HTTP client available).', 502);
    }
    if (looks_like_challenge($out)) {
        api_error('The image service blocked automated access from this network (anti-bot protection). ' .
            'Try a different internet connection, or retry in a few minutes.', 502);
    }
    return $out;
}

function http_json(string $url, ?string $postBody = null, int $timeout = 120): array
{
    $raw = http_request($url, $postBody, $timeout);
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        api_error('Image service returned an unreadable response: ' . substr(trim($raw), 0, 140), 502);
    }
    return $decoded;
}

/**
 * Fire one browser-style GET at the text service and return the parsed JSON.
 *
 * Deliberately sends NO Origin header (the ai-text-plugin's own iframe does
 * a same-origin fetch, and sending a cross-origin Origin can trigger
 * failed_verification on the text host), and uses the text host's own Referer
 * rather than the image host's.
 */
function text_verify(): array
{
    $url = TEXT_BASE . '/api/verifyUser?thread=0&__cacheBust=' . random_float();
    $binary = curl_binary();
    if ($binary !== null && function_exists('proc_open')) {
        $args = [
            $binary, '-sS',
            '--compressed',
            '--max-time', '40',
            '--connect-timeout', '25',
            '-A', UA,
            '-H', 'Accept: */*',
            '-H', 'Accept-Language: en-US,en;q=0.9',
            '-H', 'Referer: ' . TEXT_BASE . '/embed',
            $url,
        ];
        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = proc_open($args, $descriptors, $pipes);
        if (is_resource($proc)) {
            fclose($pipes[0]);
            $stdout = stream_get_contents($pipes[1]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
            if (is_string($stdout) && !looks_like_challenge($stdout)) {
                $decoded = json_decode($stdout, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
    }
    // Fallback: PHP's own curl extension.
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 40,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => UA,
        CURLOPT_HTTPHEADER     => [
            'Accept: */*',
            'Accept-Language: en-US,en;q=0.9',
            'Referer: ' . TEXT_BASE . '/embed',
        ],
    ]);
    $out = curl_exec($ch);
    curl_close($ch);
    $decoded = json_decode((string) $out, true);
    return is_array($decoded) ? $decoded : ['status' => 'unknown'];
}

/**
 * Obtain a usable session key for the TEXT host (prompt enhancer).
 *
 * Mirrors fetch_user_key() for the image host, and mirrors the embed's own
 * behavior: the tokenless verify is retried a few times with a short backoff
 * (Perchance rate-limits verification; a single attempt can transiently fail
 * with failed_verification even when the network is fine). The key is cached
 * in key.json for an hour so we never hammer verifyUser per click.
 */
function fetch_text_key(bool $forceRefresh = false): string
{
    $cached = load_key_file();

    if (!$forceRefresh && !empty($cached['text']) && preg_match('/^[a-f0-9]{64}$/i', $cached['text'])
        && (int) ($cached['text_at'] ?? 0) > time() - 3600) {
        return strtolower($cached['text']);
    }

    $status = 'unknown';
    $key    = '';
    for ($attempt = 0; $attempt < 4; $attempt++) {
        $res = text_verify();
        $status = (string) ($res['status'] ?? 'unknown');
        $key    = (string) ($res['userKey'] ?? '');
        if (in_array($status, ['success', 'already_verified'], true) && preg_match('/^[a-f0-9]{64}$/i', $key)) {
            break;
        }
        if ($attempt < 3) {
            sleep(1 + $attempt); // polite backoff, like the embed's retry loop
        }
    }

    if (in_array($status, ['success', 'already_verified'], true) && preg_match('/^[a-f0-9]{64}$/i', $key)) {
        save_key_file(['text' => strtolower($key), 'text_at' => time()]);
        return strtolower($key);
    }

    if ($status === 'invalid_key') {
        api_error('The text service rejected our session key. Try again in a minute.', 502);
    }

    api_error('The text service declined a session key (status: ' . $status . '). ' .
        'If you are on a VPN, try disabling it — or open https://perchance.org/ai-text-plugin ' .
        'once in your browser and come back.', 502);
}

/**
 * Like http_request but never dies: returns '' on any failure. Used by the
 * background and lazy saves, where a failure just means "not saved yet" (the
 * entry keeps its signed URL and is retried on demand).
 */
function try_fetch(string $url, int $timeout = 60): string
{
    $binary = curl_binary();
    if ($binary !== null) {
        $out = binary_curl($binary, $url, null, $timeout);
        if ($out !== null && !looks_like_challenge($out)) {
            return $out;
        }
    }
    if (!function_exists('curl_init')) {
        return '';
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'User-Agent: ' . UA,
            'Accept: */*',
            'Accept-Language: en-US,en;q=0.9',
            'Origin: ' . BASE,
            'Referer: ' . BASE . '/embed',
        ],
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    $body = is_string($body) ? $body : '';
    return ($body === '' || looks_like_challenge($body)) ? '' : $body;
}

/* ------------------------------------------------------------------ */
/* Key management                                                      */
/* ------------------------------------------------------------------ */

function load_key_file(): array
{
    if (is_file(KEY_FILE)) {
        $data = json_decode((string) file_get_contents(KEY_FILE), true);
        if (is_array($data)) {
            return $data;
        }
    }
    return ['manual' => '', 'auto' => '', 'at' => 0];
}

/**
 * Merge-persist key state.
 *
 * The image key, the text key, the browser id and the manual key each hold
 * their own snapshot of the file, so a plain read-modify-write would drop
 * whatever another caller had just stored (the browser id used to vanish
 * that way, minting a new one on every request).
 */
function save_key_file(array $patch): void
{
    ensure_dirs();
    @file_put_contents(KEY_FILE, json_encode(array_merge(load_key_file(), $patch)));
}

/**
 * Stable client id for the IMAGE host.
 *
 * The service binds each session key to a client id and answers
 * `client_update_required` when the request carries none — the tokenless
 * handshake only works with one (the service changed this in late September
 * 2026). Persisted in key.json so a cached key always stays paired with the
 * id that produced it.
 *
 * The TEXT host behaves the opposite way: it issues keys without an id and
 * refuses requests that send one. Never reuse this there.
 */
function image_browser_id(): string
{
    static $id = null;
    if ($id !== null) {
        return $id;
    }

    $cached = load_key_file();
    if (!empty($cached['browser_id']) && preg_match('/^[a-f0-9]{32}$/', (string) $cached['browser_id'])) {
        return $id = strtolower((string) $cached['browser_id']);
    }

    $fresh = bin2hex(random_bytes(16));
    save_key_file(['browser_id' => $fresh]);
    return $id = $fresh;
}

/**
 * Obtain a usable access key.
 * - If the admin has pasted a manual key (advanced settings), prefer it.
 * - Otherwise ask the service tokenlessly (no CAPTCHA) and cache it.
 */
function fetch_user_key(bool $forceRefresh = false): string
{
    $cached = load_key_file();

    if ($cached['manual'] !== '' && preg_match('/^[a-f0-9]{64}$/i', $cached['manual'])) {
        return strtolower($cached['manual']);
    }

    if (!$forceRefresh && $cached['auto'] !== '' && $cached['at'] > time() - 3600) {
        return $cached['auto'];
    }

    $status = 'unknown';
    $key    = '';
    for ($attempt = 0; $attempt < 4; $attempt++) {
        $res = http_json(BASE . '/api/verifyUser?browserId=' . image_browser_id() . '&thread=0&__cacheBust=' . random_float(), null, 40);
        $status = (string) ($res['status'] ?? 'unknown');
        $key    = (string) ($res['userKey'] ?? '');
        if (in_array($status, ['success', 'already_verified'], true) && preg_match('/^[a-f0-9]{64}$/i', $key)) {
            break;
        }
        if ($attempt < 3) {
            sleep(1 + $attempt); // polite backoff — verification is rate-limited
        }
    }

    if (in_array($status, ['success', 'already_verified'], true) && preg_match('/^[a-f0-9]{64}$/i', $key)) {
        save_key_file(['auto' => strtolower($key), 'at' => time()]);
        return strtolower($key);
    }

    if ($status === 'invalid_key') {
        api_error('The image service rejected our session key. Try again in a minute.', 502);
    }

    if ($status === 'client_update_required') {
        // The service changed its handshake and now treats a request without
        // a client id as an outdated client. api.php has to be a version that
        // sends one — see image_browser_id().
        api_error('The image service rejected our client as outdated (client_update_required) — ' .
            'pixelforge/api.php is out of date. Update it, or paste a session key in the advanced ' .
            'settings (data/key.json, "manual").', 502);
    }

    api_error(
        'Could not obtain an access key from the image service (status: ' . $status . '). ' .
        'If you are on a VPN, try disabling it — or open https://perchance.org/ai-text-to-image-generator ' .
        'once in your browser and come back.',
        502
    );
}

/* ------------------------------------------------------------------ */
/* Free video engine: keyless txt2video (Okatsu API)                   */
/* ------------------------------------------------------------------ */

/**
 * Plain browser-style GET that never dies — returns '' on any failure.
 * Used for the keyless video API (a Vercel app, not the Perchance hosts).
 */
function free_http_get(string $url, int $timeout = 180): string
{
    if (!function_exists('curl_init')) {
        return '';
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => ['Accept: application/json, text/plain, */*', 'Accept-Language: en-US,en;q=0.9'],
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return is_string($body) ? $body : '';
}

/**
 * Keyless text-to-video via the Okatsu txt2video API — the engine behind
 * the WhatsApp bots' `.sora` command. One request with browser-style UA,
 * a few retries with backoff (mirrors the bots' tryRequest). Returns the
 * first usable video URL found in the response, or '' when the service
 * failed.
 */
function free_txt2video(string $prompt): string
{
    $url = 'https://okatsu-rolezapiiz.vercel.app/ai/txt2video?text=' . urlencode($prompt);

    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $raw = free_http_get($url, 180);
        if ($raw !== '') {
            $j = json_decode($raw, true);
            if (is_array($j)) {
                $candidates = [
                    is_string($j['videoUrl'] ?? null) ? $j['videoUrl'] : null,
                    is_string($j['url'] ?? null)      ? $j['url']      : null,
                    is_string($j['result'] ?? null)   ? $j['result']   : null,
                    is_array($j['data'] ?? null)      ? (is_string($j['data']['videoUrl'] ?? null) ? $j['data']['videoUrl'] : null) : null,
                    is_array($j['data'] ?? null)      ? (is_string($j['data']['url'] ?? null)      ? $j['data']['url']      : null) : null,
                    is_array($j['data'] ?? null)      ? (is_string($j['data']['result'] ?? null)   ? $j['data']['result']   : null) : null,
                    is_array($j['video'] ?? null)     ? (is_string($j['video']['url'] ?? null)     ? $j['video']['url']     : null) : null,
                    is_array($j['result'] ?? null)    ? (is_string($j['result']['url'] ?? null)    ? $j['result']['url']    : null) : null,
                ];
                foreach ($candidates as $c) {
                    if (is_string($c) && preg_match('#^https?://#i', $c)) {
                        return $c;
                    }
                }
            }
        }
        if ($attempt < 3) {
            sleep(2 * $attempt); // polite backoff between retries
        }
    }
    return '';
}

const POLLINATIONS_VIDEO = 'https://gen.pollinations.ai/video/';

/**
 * Text-to-video via Pollinations (open-source, free tier — needs their free
 * key, no credit card). Returns the finished MP4 bytes, or '' on failure.
 * The endpoint answers directly with the video bytes (like its image API).
 */
function pollinations_video_bytes(string $prompt, string $key): string
{
    $url = POLLINATIONS_VIDEO . rawurlencode($prompt)
        . '?duration=5&aspectRatio=16:9&key=' . rawurlencode($key);
    if (!function_exists('curl_init')) {
        return '';
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 300,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => UA,
        CURLOPT_HTTPHEADER     => ['Accept: */*', 'Accept-Language: en-US,en;q=0.9'],
    ]);
    $bin = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!is_string($bin) || $code >= 400 || strlen($bin) < 2000) {
        return '';
    }
    // Must actually be an MP4 (ftyp box), not a JSON error page.
    return substr($bin, 4, 4) === 'ftyp' ? $bin : '';
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function load_history(): array
{
    if (is_file(HISTORY_FILE)) {
        $data = json_decode((string) file_get_contents(HISTORY_FILE), true);
        if (is_array($data)) {
            return array_values(array_filter($data, static fn ($e) => is_array($e)));
        }
    }
    return [];
}

function save_history(array $history): void
{
    file_put_contents(HISTORY_FILE, json_encode($history, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

function history_entry(string $id): ?array
{
    foreach (load_history() as $entry) {
        if (($entry['id'] ?? '') === $id) {
            return $entry;
        }
    }
    return null;
}

/**
 * Return the first history entry whose file has the given sha256 hash and
 * still exists on disk. Used to dedupe retries whose first attempt actually
 * saved, so an identical image is never saved (or listed) twice.
 */
function find_history_by_hash(string $hash, string $dir): ?array
{
    foreach (load_history() as $entry) {
        if (($entry['hash'] ?? '') !== $hash) {
            continue;
        }
        $file = $dir . '/' . basename((string) ($entry['file'] ?? ''));
        if (is_file($file)) {
            return $entry;
        }
    }
    return null;
}

/**
 * Return a history entry made from the same generation request (seed, style,
 * resolution, original prompt), if its file still exists. The free service is
 * not reliably seed-deterministic across calls, so this guarantees that
 * re-forging the exact same request returns the saved copy instead of a
 * different image (or a duplicate). Random seeds (seed < 0) never dedupe.
 */
function find_history_by_key(array $key, string $dir): ?array
{
    if ((int) ($key['seed'] ?? -1) < 0) {
        return null;
    }
    foreach (load_history() as $entry) {
        if ((int) ($entry['seed'] ?? -1) !== (int) $key['seed']) {
            continue;
        }
        if ((string) ($entry['style'] ?? '') !== (string) $key['style']) {
            continue;
        }
        if ((string) ($entry['resolution'] ?? '') !== (string) $key['resolution']) {
            continue;
        }
        if ((string) ($entry['prompt_orig'] ?? '') !== (string) $key['prompt']) {
            continue;
        }
        // Reference-ness must match: a reference-guided image and a plain
        // image of the same seed/prompt are different requests.
        if ((bool) ($entry['ref'] ?? false) !== (bool) ($key['ref'] ?? false)) {
            continue;
        }
        $file = $dir . '/' . basename((string) ($entry['file'] ?? ''));
        if (is_file($file)) {
            return $entry;
        }
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Persist the finished image + record it in history.
 *
 * The service returns a single-use download URL that is bound to this server's
 * IP, so it is always fetched here and the browser only ever gets the local
 * copy (see below).
 */
function finalize_image(array $res, array $in): array
{
    $url = $res['imageDownloadUrl'] ?? '';
    if ($url === '' || $url[0] !== '/') {
        api_error('Generation finished but the service did not return an image URL.', 502);
    }
    $remote = BASE . $url;

    ensure_dirs();
    $id   = date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
    $ext  = $res['fileExtension'] ?? 'jpeg';
    $ext  = in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true) ? ($ext === 'jpeg' ? 'jpg' : $ext) : 'jpg';
    $file = $id . '.' . $ext;

    $entry = [
        'id'          => $id,
        'file'        => $file,
        'prompt'      => $in['prompt'],
        'prompt_orig' => $in['prompt_orig'] ?? $in['prompt'],
        'negative'    => $in['negative'],
        'style'       => $in['style'],
        'resolution'  => $res['width'] . 'x' . $res['height'],
        'seed'        => (int) ($res['seed'] ?? $in['seed']),
        'maybe_nsfw'  => (bool) ($res['maybeNsfw'] ?? false),
        'ref'         => !empty($in['ref_url']),
        'created'     => date('c'),
    ];

    $history = load_history();
    array_unshift($history, $entry);
    save_history(array_slice($history, 0, 500)); // cap history at 500 entries

    // The service's image URL is single-use and bound to this server's IP:
    // whichever side consumes it first, the other gets nothing back. Always
    // download now and serve the local copy — history, downloads and story
    // mode all read data/images/, and a same-origin URL keeps the story
    // canvas untainted.
    $bin = try_fetch($remote, 60);
    $ok  = strlen($bin) >= 200 && (!function_exists('getimagesizefromstring') || @getimagesizefromstring($bin) !== false);
    if (!$ok) {
        $history = array_values(array_filter(load_history(), static fn ($e) => ($e['id'] ?? '') !== $id));
        save_history(array_slice($history, 0, 500));
        api_error('Generation finished but the image could not be downloaded from the service. Please try again.', 502);
    }

    $hash = hash('sha256', $bin);
    file_put_contents(IMG_DIR . '/' . $file, $bin);
    $entry['hash'] = $hash;
    foreach ($history as &$e) {
        if (($e['id'] ?? '') === $id) {
            $e['hash'] = $hash;
            break;
        }
    }
    unset($e);
    save_history(array_slice($history, 0, 500));

    return ['ok' => true, 'image' => $entry, 'url' => 'data/images/' . rawurlencode($file)];
}

/**
 * Make sure a history image exists on disk, fetching it from its signed URL
 * on demand when the fast generation path has not saved it yet. Returns the
 * local file path, or '' when unavailable.
 */
function ensure_image_file(array $entry): string
{
    $file = IMG_DIR . '/' . basename((string) ($entry['file'] ?? ''));
    if (is_file($file)) {
        return $file;
    }
    $remote = (string) ($entry['remote'] ?? '');
    if (!str_starts_with($remote, 'https://')) {
        return '';
    }
    $bin = try_fetch($remote, 60);
    if (strlen($bin) < 200 || (function_exists('getimagesizefromstring') && @getimagesizefromstring($bin) === false)) {
        return ''; // challenge page or junk — never persist it as an image
    }
    if (@file_put_contents($file, $bin) === false) {
        return '';
    }
    $hash    = hash('sha256', $bin);
    $history = load_history();
    foreach ($history as &$e) {
        if (($e['id'] ?? '') === ($entry['id'] ?? '')) {
            $e['hash'] = $hash;
            unset($e['remote']);
            break;
        }
    }
    unset($e);
    save_history(array_slice($history, 0, 500));
    return $file;
}

/* ------------------------------------------------------------------ */
/* AI repaint via HuggingFace Inference API (img2img, bring-your-key)  */
/* ------------------------------------------------------------------ */

/**
 * Run a real img2img repaint through the HuggingFace Inference Providers API.
 *
 * The classic api-inference.huggingface.co host was retired in 2026; the
 * replacement is a JSON POST to router.huggingface.co/hf-inference/models/{model}
 * (hf-inference = HF's own free serverless provider) with:
 *   inputs      = the reference image as a base64 string,
 *   parameters  = { prompt, strength, guidance_scale, num_inference_steps }.
 * The response is the raw output image. Retries on 503 (cold start), and on a
 * 400 parameter error retries once with a minimal parameter set (some models
 * reject optional parameters).
 */
function hf_img2img(string $prompt, string $refDataUrl, float $strength, array $cfg): string
{
    if (!function_exists('curl_init')) {
        api_error('PHP curl is not enabled — AI repaint needs it.', 502);
    }
    if ($cfg['hf_key'] === '') {
        api_error('AI repaint needs a HuggingFace token — paste one in Settings first.', 401);
    }
    $model = (string) ($cfg['hf_model'] ?? 'Lykon/dreamshaper-xl-1-0');

    // Extract the base64 payload (the router wants the bare base64 string, not
    // the full data: URI) and sanity-check that it decodes to a real image.
    $comma = strpos($refDataUrl, ',');
    if ($comma === false) {
        api_error('Reference image is not a data URL.', 400);
    }
    $b64 = (string) substr($refDataUrl, $comma + 1);
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) < 200) {
        api_error('Reference image is empty or corrupt.', 400);
    }

    $url = 'https://router.huggingface.co/hf-inference/models/' . $model;
    $lastError = 'Unknown error';
    $minimal = false; // some providers reject optional params -> retry minimal

    for ($attempt = 1; $attempt <= 5; $attempt++) {
        $parameters = $minimal
            ? ['prompt' => $prompt]
            : [
                'prompt'              => $prompt,
                'strength'            => max(0.05, min(0.95, $strength)),
                'guidance_scale'      => 7.5,
                'num_inference_steps' => 30,
            ];
        $payload = ['inputs' => $b64, 'parameters' => $parameters];

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_TIMEOUT        => 200,
            CURLOPT_CONNECTTIMEOUT => 25,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $cfg['hf_key'],
                'Content-Type: application/json',
                'Accept: image/*',
                'User-Agent: PixelForge/1.0',
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload),
        ]);
        $raw  = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $raw === '') {
            $lastError = 'Network error: ' . $err;
        } elseif ($code >= 200 && $code < 300) {
            // Success — validate it is actually an image.
            if (function_exists('getimagesizefromstring')) {
                $info = @getimagesizefromstring($raw);
                if ($info === false) {
                    $lastError = 'The model returned something that is not an image.';
                } else {
                    return $raw;
                }
            } else {
                return $raw;
            }
        } elseif ($code === 401 || $code === 403) {
            api_error('HuggingFace rejected the token (HTTP ' . $code . '). Check it in Settings and try again.', 401);
        } elseif ($code === 503) {
            // Serverless model is cold-starting; retry with a pause.
            $lastError = 'Model is loading (503) — retrying…';
            sleep(8 * $attempt);
        } else {
            $body = (string) $raw;
            $msg  = $body;
            if (str_starts_with($body, '{')) {
                $j = json_decode($body, true);
                $msg = is_array($j) ? (string) ($j['error'] ?? $body) : $body;
            }
            // Keep the error message JSON-safe (some gateways return binary/HTML).
            $msg = substr(preg_replace('/[^\x20-\x7E]/', ' ', $msg), 0, 220);
            if ($code === 404) {
                api_error('Model not found: ' . $model . '. Pick another — see data/config.json (hf_model).', 502);
            }
            if ($code === 429) {
                api_error('HuggingFace free tier is rate-limited (429). Wait a minute and retry.', 429);
            }
            // Some providers reject optional parameters with a 400 — retry once
            // with only the prompt. If that also fails, stop hammering the API.
            if ($code === 400 && !$minimal) {
                $minimal = true;
                $lastError = 'Retrying with basic parameters…';
                continue;
            }
            if ($code === 400) {
                $lastError = 'Model error (HTTP 400): ' . $msg;
                break;
            }
            $lastError = 'Model error (HTTP ' . $code . '): ' . $msg;
        }
        if ($attempt < 5) {
            sleep(2);
        }
    }
    api_error('AI repaint failed: ' . $lastError, 502);
}

/**
 * Persist raw generated bytes (AI repaint results) as a history entry.
 * Mirrors finalize_image() but takes bytes instead of a download URL.
 */
function save_generated_bytes(string $bin, array $in): array
{
    if (strlen($bin) < 200) {
        api_error('The generated image is too small — nothing was saved.', 502);
    }
    $info = null;
    if (function_exists('getimagesizefromstring')) {
        $info = @getimagesizefromstring($bin);
        if ($info === false) {
            api_error('The model returned an unreadable image — nothing was saved.', 502);
        }
    }
    $hash = hash('sha256', $bin);
    $dup  = find_history_by_hash($hash, IMG_DIR);
    if ($dup !== null) {
        return [
            'ok'        => true,
            'image'     => $dup,
            'url'       => 'data/images/' . rawurlencode((string) $dup['file']),
            'duplicate' => true,
        ];
    }

    ensure_dirs();
    $id = date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
    $ext = 'jpg';
    if ($info !== null) {
        $mimeType = $info['mime'] ?? '';
        if ($mimeType === 'image/png')  $ext = 'png';
        elseif ($mimeType === 'image/webp') $ext = 'webp';
    }
    $file = $id . '.' . $ext;
    file_put_contents(IMG_DIR . '/' . $file, $bin);

    $entry = [
        'id'          => $id,
        'file'        => $file,
        'hash'        => $hash,
        'prompt'      => $in['prompt'],
        'prompt_orig' => $in['prompt_orig'] ?? $in['prompt'],
        'negative'    => $in['negative'] ?? '',
        'style'       => $in['style'],
        'resolution'  => ($info[0] ?? 0) . 'x' . ($info[1] ?? 0),
        'seed'        => (int) ($in['seed'] ?? -1),
        'maybe_nsfw'  => false,
        'ref'         => true,
        'engine'      => 'ai',
        'created'     => date('c'),
    ];

    $history = load_history();
    array_unshift($history, $entry);
    save_history(array_slice($history, 0, 500));

    return [
        'ok'    => true,
        'image' => $entry,
        'url'   => 'data/images/' . rawurlencode($file),
    ];
}

/* ------------------------------------------------------------------ */
/* Free-engine load state (drives the "under load" header indicator)   */
/* ------------------------------------------------------------------ */

/**
 * Read the free-engine load state, and — when $markBusy is provided — update
 * the matching timestamp and persist it, all under an exclusive lock so two
 * concurrent generations can never lose each other's outcome.
 *
 * Returns the (possibly updated) state: ['busy_at' => int, 'ok_at' => int].
 */
function service_load_state(?bool $markBusy = null): array
{
    ensure_dirs();
    $state = ['busy_at' => 0, 'ok_at' => 0];
    $fp = @fopen(BUSY_FILE, 'c+');
    if ($fp === false) {
        return $state;
    }
    if (flock($fp, LOCK_EX)) {
        $raw = stream_get_contents($fp);
        $prev = json_decode((string) $raw, true);
        if (is_array($prev)) {
            $state['busy_at'] = (int) ($prev['busy_at'] ?? 0);
            $state['ok_at']   = (int) ($prev['ok_at'] ?? 0);
        }
        if ($markBusy !== null) {
            $state[$markBusy ? 'busy_at' : 'ok_at'] = time();
            rewind($fp);
            ftruncate($fp, 0);
            fwrite($fp, json_encode($state));
            fflush($fp);
        }
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return $state;
}

/** Record the outcome of the last free-engine generation (a success clears it). */
function mark_service_load(bool $busy): void
{
    service_load_state($busy);
}

/**
 * True while the shared free engine is under load: the most recent outcome
 * was a busy queue and it happened within the last 5 minutes. Any success
 * afterwards flips it straight back to normal.
 */
function service_under_load(): bool
{
    $state = service_load_state();
    return $state['busy_at'] > $state['ok_at'] && time() - $state['busy_at'] < 300;
}

/* ------------------------------------------------------------------ */
/* Reference-image relay (free img2img needs a PUBLIC url)              */
/* ------------------------------------------------------------------ */

/**
 * Load the data-URL -> public-URL relay cache (content-hash keyed so the
 * same photo never gets uploaded twice, even across retries).
 */
function load_ref_cache(): array
{
    if (is_file(REF_CACHE_FILE)) {
        $data = json_decode((string) file_get_contents(REF_CACHE_FILE), true);
        if (is_array($data)) {
            return $data;
        }
    }
    return [];
}

/** Persist the relay cache (capped to 500 entries, oldest dropped). */
function save_ref_cache(array $cache): void
{
    ensure_dirs();
    if (count($cache) > 500) {
        $cache = array_slice($cache, -500, 500, true);
    }
    // Exclusive lock so concurrent same-photo requests can't interleave writes.
    $fp = @fopen(REF_CACHE_FILE, 'c+');
    if ($fp === false) {
        return;
    }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($cache));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

/**
 * Upload raw image bytes to a free anonymous public image host so the
 * Perchance service can fetch them. Tries catbox.moe (3 attempts — it
 * occasionally returns an empty 200), then falls back to tmpfiles.org.
 * Returns the public URL, or '' if every host failed.
 * Uses the system curl binary when available (same transport trick as the
 * rest of the file), else PHP's curl extension.
 */
function upload_reference_bytes(string $bin): string
{
    if (strlen($bin) > 6 * 1024 * 1024) {
        return ''; // refuse oversized uploads
    }
    // Sniff the real type so the MIME sent to the host matches the bytes
    // (the regex allows png/webp/gif too, even though the frontend sends jpeg).
    $mime = 'image/jpeg';
    $ext  = 'jpg';
    if (function_exists('getimagesizefromstring')) {
        $info = @getimagesizefromstring($bin);
        if (is_array($info) && isset($info['mime'])) {
            $mime = $info['mime'];
            if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
                $mime = 'image/jpeg';
            }
        }
    }
    $ext = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : ($mime === 'image/gif' ? 'gif' : 'jpg'));

    // tempnam() already creates the file — use its path directly (the upload
    // MIME is passed explicitly, so no extension juggling is needed).
    $tmp = tempnam(sys_get_temp_dir(), 'pfref');
    if ($tmp === false) {
        return '';
    }
    file_put_contents($tmp, $bin);

    $binary = curl_binary();
    $url = '';

    $multipart = static function (string $endpoint, array $fields) use ($tmp, $mime, $ext, $binary): string {
        if ($binary !== null && function_exists('proc_open')) {
            $args = [
                $binary, '-sS',
                '--compressed',
                '--max-time', '60',
                '--connect-timeout', '25',
                '-A', UA,
                '-X', 'POST',
            ];
            foreach ($fields as $k => $v) {
                if ($v === '@FILE') {
                    $args[] = '-F';
                    $args[] = 'fileToUpload=@' . $tmp . ';type=' . $mime . ';filename=reference.' . $ext;
                } else {
                    $args[] = '-F';
                    $args[] = $k . '=' . $v;
                }
            }
            $args[] = $endpoint;
            $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
            $proc = proc_open($args, $descriptors, $pipes);
            if (!is_resource($proc)) {
                return '';
            }
            fclose($pipes[0]); // close stdin so the child never waits on EOF
            $out = stream_get_contents($pipes[1]);
            stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
            return trim((string) $out);
        }
        if (function_exists('curl_init')) {
            $post = [];
            foreach ($fields as $k => $v) {
                $post[$k] = $v === '@FILE' ? new CURLFile($tmp, $mime, 'reference.' . $ext) : $v;
            }
            $ch = curl_init($endpoint);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $post,
                CURLOPT_TIMEOUT        => 60,
                CURLOPT_CONNECTTIMEOUT => 25,
                CURLOPT_USERAGENT      => UA,
            ]);
            $body = curl_exec($ch);
            curl_close($ch);
            return trim((string) $body);
        }
        return '';
    };

    // Host 1: catbox.moe — retry a few times, it occasionally 200s empty.
    for ($i = 0; $i < 3 && $url === ''; $i++) {
        $out = $multipart('https://catbox.moe/user/api.php', ['reqtype' => 'fileupload', 'fileToUpload' => '@FILE']);
        if (str_starts_with($out, 'https://')) {
            $url = $out;
        } elseif ($i < 2) {
            sleep(2);
        }
    }

    // Host 2: tmpfiles.org — needs a real filename; direct-download URLs
    // use /dl/ (the bare /{id}/{name} page is HTML the model can't read).
    if ($url === '') {
        $out = $multipart('https://tmpfiles.org/api/v1/upload', ['file' => '@FILE']);
        $j = json_decode($out, true);
        if (is_array($j) && ($j['status'] ?? '') === 'success' && !empty($j['data']['url'])) {
            $page = (string) $j['data']['url']; // https://tmpfiles.org/{id}/{name}
            $url  = preg_replace('#^https://tmpfiles\.org/#', 'https://tmpfiles.org/dl/', $page);
        }
    }

    @unlink($tmp);
    return $url;
}

/**
 * Turn a reference data URL into a public URL the free service can fetch.
 * - http(s) URLs pass through untouched.
 * - base64 data URLs are decoded, uploaded to a public host and cached by
 *   content hash (sha256) so the same photo reuses the same URL.
 * Returns '' if the reference can't be relayed.
 */
function publish_reference(string $refUrl): string
{
    $refUrl = trim($refUrl);
    if ($refUrl === '') {
        return '';
    }
    // Already public — nothing to do. (Only reachable from the generate
    // handler, which still requires data: URLs from the client, so a user
    // can't slip arbitrary URLs through to the relay.)
    if (str_starts_with($refUrl, 'http://') || str_starts_with($refUrl, 'https://')) {
        return $refUrl;
    }
    // Must be a base64 data URL (the frontend sends downscaled JPEGs).
    if (!preg_match('#^data:image/(jpeg|png|webp|gif);base64,#i', $refUrl)) {
        return '';
    }
    $comma = strpos($refUrl, ',');
    if ($comma === false) {
        return '';
    }
    $b64 = substr($refUrl, $comma + 1);
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) < 200) {
        return '';
    }

    $hash = hash('sha256', $bin);
    $cache = load_ref_cache();
    if (!empty($cache[$hash])) {
        return (string) $cache[$hash];
    }

    $pub = upload_reference_bytes($bin);
    if ($pub === '') {
        return '';
    }
    $cache[$hash] = $pub;
    save_ref_cache($cache);
    return $pub;
}

function generate_image(array $in): array
{
    // Custom sizes get a second chance: if the engine rejects the requested
    // dimensions (e.g. an unsupported aspect), retry once at the nearest
    // natively supported size and tell the client what happened.
    $fallback = (string) ($in['fallback_dims'] ?? '');
    $result   = generate_image_attempt($in);
    if ($result === null) {
        // Queue busy — retry at the fallback only makes sense for a rejection,
        // not for load, so surface the busy error immediately (as before).
        mark_service_load(true);
        api_error('The free image service queue is busy right now — the shared service is under load. Wait about a minute, then try again.', 429);
    }
    mark_service_load(false);
    if (!empty($result['upstream'])) {
        if ($fallback !== '' && $fallback !== $in['resolution']) {
            $in['resolution']   = $fallback;
            $in['fallback_dims'] = '';
            $retry = generate_image_attempt($in);
            if ($retry !== null && empty($retry['upstream'])) {
                $retry['note'] = 'The free engine does not support ' . $result['resolution'] .
                    ' — it forged ' . $fallback . ' instead (nearest supported size).';
                return $retry;
            }
            if ($retry !== null) {
                $result = $retry;
            }
        }
        $status = (string) ($result['upstream'] ?? 'unknown');
        api_error('Image service responded: ' . $status . '. Please try again.', 502);
    }
    return $result;
}

/**
 * A single free-engine attempt. Returns the saved result, or null when the
 * upstream queue stayed busy after a patient wait, or an array with an
 * 'upstream' error key when the service replied with an unhandled status.
 */
function generate_image_attempt(array $in): ?array
{
    $result = generate_image_pass($in, fetch_user_key());
    if ($result !== null && !empty($result['upstream'])) {
        return ['upstream' => $result['upstream'], 'resolution' => $in['resolution']];
    }
    return $result;
}

/**
 * One generation attempt with a fixed session key. Returns the saved result,
 * or null when the upstream queue stayed busy after a patient wait (the caller
 * then retries once with a fresh key).
 */
function generate_image_pass(array $in, string $key, int $attempt = 0): ?array
{
    $requestId = random_float();
    $body      = [
        'prompt'         => $in['prompt'],
        'negativePrompt' => $in['negative'],
        'seed'           => (int) $in['seed'],
        'resolution'     => $in['resolution'],
        'guidanceScale'  => (float) $in['guidance'],
        'channel'        => 'ai-text-to-image-generator',
        'subChannel'     => 'public',
        'userKey'        => $key,
        'adAccessCode'   => '',
        'requestId'      => $requestId,
    ];

    // img2img: the free service accepts a referenceImage {url, blur} field.
    // The url MUST be a public http(s) URL — the service fetches it server-
    // side, and silently ignores base64 data: URLs (it returns success but
    // generates without the reference). So relay the photo to a public host
    // first (cached by content hash so retries reuse the same URL).
    if (!empty($in['ref_url'])) {
        $pubRef = publish_reference((string) $in['ref_url']);
        if ($pubRef === '') {
            api_error(
                'Could not relay the reference image to the free image service (upload failed). ' .
                'Try again in a moment, or use ✨ AI Repaint (needs a free HuggingFace token) instead.',
                502
            );
        }
        $body['referenceImage'] = [
            'url'  => $pubRef,
            'blur' => (float) ($in['ref_blur'] ?? 0.5),
        ];
    }

    $url = BASE . '/api/generate?userKey=' . $key . '&requestId=' . $requestId . '&__cacheBust=' . random_float();
    $res = generate_once($url, json_encode($body));
    $status = $res['status'] ?? 'unknown';

    if ($status === 'invalid_key') {
        // Stale key — refresh once and retry.
        $key = fetch_user_key(true);
        $body['userKey'] = $key;
        $res = generate_once(
            BASE . '/api/generate?userKey=' . $key . '&requestId=' . $requestId . '&__cacheBust=' . random_float(),
            json_encode($body)
        );
        $status = $res['status'] ?? 'unknown';
    }

    if ($status === 'success' && !empty($res['imageDownloadUrl'])) {
        return finalize_image($res, $in);
    }

    // The service sometimes queues requests behind other users' generations.
    if (in_array($status, ['waiting_for_prev_request_to_finish', 'queued'], true)) {
        // Poll the queue fast at first so a job that is already done is
        // noticed in ~1s instead of after a fixed 5s tick, then ease off as
        // the wait grows so a long queue spell does not hammer the endpoint.
        // Total patience stays ~2.5 minutes; the client's Stop button still
        // aborts immediately (connection_aborted below).
        $t0 = microtime(true);
        $i  = 0;
        while (microtime(true) - $t0 < 150 && $i < 60) {
            // Client pressed Stop — stop polling so the queue slot frees up fast.
            if (connection_aborted()) {
                exit;
            }
            if ($i++ > 0) {
                // Ramp: ~1s polls for the first ~10s, easing up to 5s after ~40s.
                $interval = (int) min(5, 1 + (microtime(true) - $t0) / 10);
                sleep($interval);
            }
            $q = http_json(BASE . '/api/getUserQueuePosition?userKey=' . $key . '&requestId=' . $requestId, null, 40);
            if (($q['status'] ?? '') === 'success' && !empty($q['imageDownloadUrl'])) {
                return finalize_image($q, $in);
            }
            if (in_array($q['status'] ?? '', ['not_in_queue', 'stale_request'], true)) {
                break;
            }
        }
        return null; // still busy — the caller retries with a fresh key
    }

    // Occasionally the service reports success but leaves the image URL out of
    // the response. That is transient, so retry once with a fresh key instead
    // of surfacing a confusing "responded: success" error.
    if ($status === 'success' && $attempt === 0) {
        return generate_image_pass($in, fetch_user_key(true), 1);
    }

    // Upstream answered with something we don't understand (e.g. an
    // unsupported resolution). Surface it to the caller so a custom-size
    // request can retry once at a natively supported size; otherwise the
    // caller turns this into the usual 502 message.
    return ['ok' => false, 'upstream' => $status];
}

/**
 * Fire one generate request, tolerating transient upstream 500s.
 * The free service occasionally hiccups ("Internal Server Error") while a
 * previous request on the same session key is still settling.
 */
function generate_once(string $url, string $body): array
{
    for ($attempt = 1; $attempt <= 4; $attempt++) {
        $raw = http_request($url, $body, 180);
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return $decoded;
        }
        // Non-JSON (e.g. "Internal Server Error") -> wait and retry.
        if ($attempt < 4) {
            sleep(3 * $attempt);
        }
    }
    api_error('Image service is struggling right now (server error). Wait a few seconds and try again.', 502);
}

/* ------------------------------------------------------------------ */
/* Prompt enhancer (ai-text-plugin API on the text-generation host)     */
/* ------------------------------------------------------------------ */

/**
 * Fire one JSON POST at the text-generation service and return the raw
 * streamed response. Uses the system curl binary with browser-style headers
 * (same anti-bot trick as the image API). No Origin header is sent — the
 * plugin's own iframe performs a same-origin fetch, and sending a cross-
 * origin Origin can trigger invalid_data on this endpoint.
 */
function text_request(string $url, array $body, int $timeout = 180): string
{
    $payload = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $binary  = curl_binary();
    if ($binary !== null && function_exists('proc_open')) {
        $args = [
            $binary, '-sS',
            '--compressed',
            '--max-time', (string) $timeout,
            '--connect-timeout', '25',
            '-A', UA,
            '-H', 'Accept: */*',
            '-H', 'Accept-Language: en-US,en;q=0.9',
            '-H', 'Referer: ' . TEXT_BASE . '/embed',
            '-X', 'POST',
            '--data-binary', '@-',
            $url,
        ];
        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = proc_open($args, $descriptors, $pipes);
        if (is_resource($proc)) {
            fwrite($pipes[0], $payload);
            fclose($pipes[0]);
            $stdout = stream_get_contents($pipes[1]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
            if (is_string($stdout) && !looks_like_challenge($stdout)) {
                return $stdout;
            }
        }
    }
    // Fallback: PHP's own curl extension.
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => UA,
        CURLOPT_HTTPHEADER     => [
            'Accept: */*',
            'Accept-Language: en-US,en;q=0.9',
            'Referer: ' . TEXT_BASE . '/embed',
        ],
    ]);
    $out = curl_exec($ch);
    curl_close($ch);
    return is_string($out) ? $out : '';
}

/**
 * Enhance / expand a user's image prompt via the free ai-text-plugin API.
 *
 * Replicates the exact wire format of the Perchance plugin (verified live):
 * the first space of `instruction` becomes a non-breaking space marker, and
 * the payload must include stopSequences plus token-count fields or the
 * service answers invalid_data. The response streams as lines of
 * `t:"chunk"` followed by a final `data:{...}` JSON marker.
 */
function enhance_prompt(string $prompt, string $instruction): string
{
    $prompt = trim($prompt);
    if ($prompt === '') {
        api_error('Nothing to enhance — write a prompt first.', 400);
    }
    if (mb_strlen($prompt) > 1500) {
        $prompt = mb_substr($prompt, 0, 1500);
    }

    // Obtain a tokenless session key (cached for an hour, with retry —
    // the text host rate-limits verification, so we never hit it per click).
    $key = fetch_text_key();

    // The plugin's instruction is the prompt to expand, with its first space
    // swapped for a non-breaking space (the ai-text-plugin's "marker").
    $instruction = trim($instruction);
    if ($instruction === '') {
        $instruction = 'Expand this image prompt into a detailed, vivid version. ' .
            'Add lighting, composition, colors, textures, mood and camera details. ' .
            'Return only the expanded prompt.';
    }
    $instruction .= "\n\n" . $prompt;
    $marker = strpos($instruction, ' ');
    if ($marker !== false) {
        // Replace with a full NBSP (U+00A0). String-offset assignment would
        // only keep the first byte and corrupt the UTF-8, breaking json_encode.
        $instruction = substr_replace($instruction, "\xC2\xA0", $marker, 1);
    }

    $requestId = 'aiTextCompletion' . str_replace('.', '', (string) random_float());
    $body = [
        'instruction'           => $instruction,
        'startWith'             => '',
        'stopSequences'         => [],
        'generatorName'         => 'ai-text-plugin',
        'startWithTokenCount'   => 0,
        // Approximate token count for the full instruction (system prefix +
        // user prompt); the service uses it for context trimming.
        'instructionTokenCount' => max(1, (int) ceil(mb_strlen($instruction) / 4)),
    ];

    $url = TEXT_BASE . '/api/generate?userKey=' . $key
        . '&thread=0&requestId=' . $requestId
        . '&__cacheBust=' . random_float();

    // Retry once on invalid_key with a fresh key (session keys expire).
    $raw = text_request($url, $body);
    if (str_contains($raw, 'invalid_key')) {
        $res = text_verify();
        $key = strtolower((string) ($res['userKey'] ?? ''));
        if (preg_match('/^[a-f0-9]{64}$/', $key)) {
            $url = TEXT_BASE . '/api/generate?userKey=' . $key
                . '&thread=0&requestId=' . $requestId
                . '&__cacheBust=' . random_float();
            $raw = text_request($url, $body);
        }
    }
    if (str_contains($raw, 'invalid_data')) {
        api_error('The text service rejected the request (invalid_data). Try again in a moment.', 502);
    }
    if (str_contains($raw, 'invalid_key')) {
        api_error('The text service rejected our session key. Try again in a minute.', 502);
    }
    if (looks_like_challenge($raw)) {
        api_error('The text service blocked automated access from this network. Try again in a few minutes.', 502);
    }

    // Concatenate the streamed chunks: lines look like `t:"..."` and the
    // stream ends with `data:{...}` (final marker). Chunks are JSON strings.
    $text = '';
    foreach (explode("\n", $raw) as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        if (str_starts_with($line, 't:')) {
            $json = substr($line, 2);
            $decoded = json_decode($json, true);
            if (is_string($decoded)) {
                $text .= $decoded;
            }
        } elseif (str_starts_with($line, 'data:')) {
            $meta = json_decode(substr($line, 5), true);
            if (is_array($meta) && !empty($meta['final'])) {
                break;
            }
        }
    }

    $text = trim($text);
    if ($text === '') {
        api_error('The text service returned nothing useful. Try again in a few seconds.', 502);
    }
    return $text;
}

/* ------------------------------------------------------------------ */
/* CSRF protection & input sanitization                                */
/* ------------------------------------------------------------------ */

/**
 * Generate a per-session CSRF token and store it in the session.
 * Returns the token string.
 */
function csrf_token(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        @session_start(); // may be disabled on some hosts — see fallback below
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (empty($_SESSION['pf_csrf'])) {
            $_SESSION['pf_csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['pf_csrf'];
    }
    // No session support: fall back to a cookie-pinned token so POSTs still
    // verify (first call sets it, later calls reuse it for this browser).
    static $fallback = null;
    if ($fallback === null) {
        $fallback = isset($_COOKIE['pf_csrf']) && preg_match('/^[a-f0-9]{64}$/', (string) $_COOKIE['pf_csrf'])
            ? (string) $_COOKIE['pf_csrf']
            : bin2hex(random_bytes(32));
        if (!headers_sent()) {
            setcookie('pf_csrf', $fallback, ['samesite' => 'Lax', 'path' => '/']);
        }
    }
    return $fallback;
}

/**
 * Validate a CSRF token submitted via POST 'csrf' field.
 * Stateless GET requests are exempt (they don't change state).
 */
function csrf_validate(): void
{
    // CLI (tests) has no real HTTP method — nothing to validate.
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        return; // GET requests are idempotent — no CSRF risk
    }
    // Endpoints that are read-only, or that only accept a strict-format key
    // via curl for manual/headless setup (documented in the README), are
    // exempt. Everything else — generate, delete, clear_all, video renders,
    // uploads, TTS — must carry a token.
    $action = $_REQUEST['action'] ?? '';
    $exempt = ['status', 'styles', 'voices', 'history', 'videokey', 'hfkey', 'pollikey', 'setkey', 'download', 'verify'];
    if (in_array($action, $exempt, true)) {
        return;
    }
    $token = $_POST['csrf'] ?? $_GET['csrf'] ?? '';
    if ($token === '' || !hash_equals(csrf_token(), $token)) {
        api_error('Invalid or missing security token. Please refresh the page.', 403);
    }
}

/**
 * Sanitize a free-text prompt: strip control chars, collapse whitespace,
 * enforce a max length, and remove HTML/script tags.
 */
function sanitize_prompt(string $text, int $maxLen = 2000): string
{
    // Strip HTML tags and null bytes
    $text = preg_replace('#<[^>]+>#', '', $text);
    $text = str_replace(["\0", "\x0B", "\x0C"], '', $text);
    // Collapse whitespace
    $text = preg_replace('/\s+/', ' ', $text);
    $text = trim($text);
    return mb_substr($text, 0, $maxLen);
}

/**
 * Sanitize a style key: allow only alphanumeric, hyphens, underscores.
 */
function sanitize_style(string $style): string
{
    return preg_replace('/[^a-zA-Z0-9_-]/', '', $style);
}

/**
 * Sanitize a resolution key: only allow known values.
 */
function sanitize_resolution(string $res): string
{
    $allowed = ['square', 'portrait', 'landscape', 'custom', '16:9', '9:16', '1:1'];
    return in_array($res, $allowed, true) ? $res : 'square';
}

/**
 * Snap a pixel dimension into what the free SD1.5 engine can actually
 * produce: a multiple of 64 within 256–768 (its native range). Returns the
 * clamped value.
 */
function snap_dim(int $v): int
{
    $v = max(256, min(768, $v));
    return (int) (round($v / 64) * 64);
}

/**
 * Turn user custom width/height into a canonical "WxH" string, e.g. 640x640.
 */
function snap_resolution_dims(int $w, int $h): string
{
    return snap_dim($w) . 'x' . snap_dim($h);
}

/**
 * The free engine's natively supported outputs are the preset trio
 * (768x768 / 512x768 / 768x512). When a custom size is rejected, fall back to
 * the canonical size whose aspect ratio matches the request.
 */
function nearest_supported_dims(int $w, int $h): string
{
    if ($w > $h) {
        return '768x512'; // landscape
    }
    if ($h > $w) {
        return '512x768'; // portrait
    }
    return '768x768'; // square
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

$action = $_REQUEST['action'] ?? '';

// Validate CSRF on state-changing requests before routing.
csrf_validate();

// Release the PHP session file lock immediately: generations and video
// renders can run for minutes, and a held lock would block the browser's
// parallel status/poll requests (they share the same session cookie).
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

if (defined('PF_SKIP_ROUTING')) {
    // Used by internal tests to include these functions without routing.
    return;
}

switch ($action) {
    case 'status':
        ensure_dirs();
        $cached = load_key_file();
        $manual = $cached['manual'] !== '';
        $auto   = $cached['auto'] !== '' && $cached['at'] > time() - 3600;
        $busy   = service_under_load();
        api_out([
            'ok'      => true,
            'service' => 'Perchance free image API',
            'key'     => $manual ? 'manual' : ($auto ? 'ready' : 'unverified'),
            'busy'    => $busy,
            'images'  => count(glob(IMG_DIR . '/*.{jpg,jpeg,png,webp}', GLOB_BRACE) ?: []),
            'videos'  => count(glob(VIDEO_DIR . '/*.mp4', GLOB_BRACE) ?: []),
            'styles'  => array_keys(STYLES),
            'csrf'    => csrf_token(),
        ]);

    case 'enhance':
        // Expand / rewrite a prompt via the free ai-text-plugin API.
        $prompt     = (string) ($_REQUEST['prompt'] ?? '');
        $instruction = (string) ($_REQUEST['instruction'] ?? '');
        api_out(['ok' => true, 'text' => enhance_prompt($prompt, $instruction)]);

    case 'videokey':
        // Video mode API key management. Keys are stored OUTSIDE the web root
        // (pixelforge.secrets.php two folders up) or in environment variables.
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $key = trim((string) ($_POST['key'] ?? ''));
            if ($key === '') {
                api_error('Enter your Replicate API key (starts with r8_).');
            }
            if (strlen($key) < 20 || !preg_match('/^r8_[A-Za-z0-9._-]+$/', $key)) {
                api_error('That does not look like a Replicate API key (should start with r8_).');
            }
            save_secret('replicate_key', $key);
            api_out(['ok' => true, 'saved' => true]);
        }
        $cfg = load_video_config();
        api_out(['ok' => true, 'has_key' => $cfg['replicate_key'] !== '', 'model' => $cfg['video_model']]);

    case 'hfkey':
        // HuggingFace token for AI Repaint (img2img). Stored outside the web
        // root (secrets file / environment variable) — never in config.json.
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            if (!empty($_POST['clear'])) {
                save_secret('hf_key', '');
            } else {
                $key = trim((string) ($_POST['key'] ?? ''));
                if ($key === '' || !preg_match('/^hf_[A-Za-z0-9]+$/', $key)) {
                    api_error('That does not look like a HuggingFace token (starts with hf_).');
                }
                save_secret('hf_key', $key);
            }
            if (!empty($_POST['model']) && preg_match('#^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$#', (string) $_POST['model'])) {
                $cfg = load_video_config();
                $cfg['hf_model'] = (string) $_POST['model'];
                save_video_config($cfg);
            }
            api_out(['ok' => true, 'saved' => true]);
        }
        $cfg = load_video_config();
        api_out(['ok' => true, 'has_key' => $cfg['hf_key'] !== '', 'model' => $cfg['hf_model']]);

    case 'repaint_save':
        // Save a locally-rendered repaint (browser canvas effect) to history.
        ensure_dirs();
        $image = trim((string) ($_POST['image'] ?? ''));
        if (!preg_match('#^data:image/(jpeg|png|webp);base64,#i', $image)) {
            api_error('Repaint image must be a JPEG/PNG/WebP data URL.');
        }
        if (strlen($image) > 4 * 1024 * 1024) {
            api_error('Repaint image is too large (max 4 MB).');
        }
        $bin = base64_decode((string) substr($image, (int) strpos($image, ',') + 1), true);
        if ($bin === false || strlen($bin) < 200) {
            api_error('Repaint image is empty or corrupt.');
        }
        $info = null;
        if (function_exists('getimagesizefromstring')) {
            $info = @getimagesizefromstring($bin);
            if ($info === false) {
                api_error('Repaint image is not a decodable image.');
            }
        }
        $style  = preg_replace('/[^a-z0-9 _\-]/i', '', (string) ($_POST['style'] ?? 'repaint'));
        $blend  = max(0, min(1, (float) ($_POST['blend'] ?? 0.5)));
        $prompt = trim((string) ($_POST['prompt'] ?? ''));
        if ($prompt === '') {
            $prompt = '🖼 Repaint · ' . ($style !== '' ? $style : 'effect');
        }
        $hash = hash('sha256', $bin);
        $dup  = find_history_by_hash($hash, IMG_DIR);
        if ($dup !== null) {
            api_out(['ok' => true, 'image' => $dup, 'url' => 'data/images/' . rawurlencode((string) $dup['file']), 'duplicate' => true]);
        }
        $id   = date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
        $ext  = str_contains($image, 'image/png') ? 'png' : (str_contains($image, 'image/webp') ? 'webp' : 'jpg');
        $file = $id . '.' . $ext;
        file_put_contents(IMG_DIR . '/' . $file, $bin);
        $entry = [
            'id'          => $id,
            'file'        => $file,
            'hash'        => $hash,
            'prompt'      => $prompt,
            'prompt_orig' => $prompt,
            'negative'    => '',
            'style'       => $style,
            'resolution'  => ($info[0] ?? 0) . 'x' . ($info[1] ?? 0),
            'seed'        => -1,
            'maybe_nsfw'  => false,
            'ref'         => true,
            'engine'      => 'local',
            'repaint'     => $style,
            'blend'       => $blend,
            'created'     => date('c'),
        ];
        $history = load_history();
        array_unshift($history, $entry);
        save_history(array_slice($history, 0, 500));
        api_out(['ok' => true, 'image' => $entry, 'url' => 'data/images/' . rawurlencode($file)]);

    case 'video_start':
        // Kick off a Replicate text-to-video prediction.
        ensure_dirs();
        $cfg = load_video_config();
        if ($cfg['replicate_key'] === '') {
            api_error('Video mode needs a Replicate API key. Paste it in Video mode first.', 401);
        }
        $prompt = sanitize_prompt((string) ($_POST['prompt'] ?? ''));
        if ($prompt === '') {
            api_error('Please describe the video you want to create.');
        }
        $style = sanitize_style((string) ($_POST['style'] ?? 'none'));
        $styleTemplates = load_style_templates();
        if (!isset(STYLES[$style]) && !isset($styleTemplates[$style])) {
            $style = 'none';
        }
        if (isset($styleTemplates[$style])) {
            $prompt = render_style_template($styleTemplates[$style], $prompt);
        } elseif (isset(STYLES[$style]) && $style !== 'none') {
            $prompt = $prompt . ', ' . STYLES[$style][0];
        }
        if (mb_strlen($prompt) > 1000) {
            $prompt = mb_substr($prompt, 0, 1000);
        }

        $res = replicate_request('POST', 'https://api.replicate.com/v1/models/' .
            urlencode($cfg['video_model']) . '/predictions', [
            'input' => ['prompt' => $prompt, 'aspect_ratio' => '16:9', 'duration' => 5],
        ], $cfg['replicate_key']);

        if ($res['code'] === 401) {
            api_error('Replicate rejected the API key. Check it and try again.', 401);
        }
        if ($res['code'] === 404) {
            api_error('Video model not found (' . $cfg['video_model'] . '). Edit pixelforge/data/config.json to pick a valid model.', 502);
        }
        if ($res['code'] !== 201 && $res['code'] !== 200) {
            $err = $res['body']['detail'] ?? $res['body']['raw'] ?? 'unknown error';
            api_error('Could not start the video render: ' . $err, 502);
        }
        $id = $res['body']['id'] ?? '';
        if ($id === '') {
            api_error('Replicate did not return a prediction id.', 502);
        }
        api_out(['ok' => true, 'id' => $id]);

    case 'video_status':
        // Poll a running prediction; fetch the MP4 once it succeeds.
        $cfg = load_video_config();
        $id  = (string) ($_GET['id'] ?? '');
        if ($id === '' || $cfg['replicate_key'] === '') {
            api_error('Missing prediction id or API key.');
        }
        $res = replicate_request('GET', 'https://api.replicate.com/v1/predictions/' .
            urlencode($id), [], $cfg['replicate_key']);
        if ($res['code'] === 404) {
            api_out(['ok' => true, 'status' => 'gone']);
        }
        if ($res['code'] !== 200) {
            api_out(['ok' => true, 'status' => 'retry']);
        }
        $status = $res['body']['status'] ?? 'unknown';
        if (in_array($status, ['starting', 'processing'], true)) {
            api_out(['ok' => true, 'status' => 'processing']);
        }
        if ($status === 'succeeded') {
            $out = $res['body']['output'] ?? '';
            if (is_array($out)) {
                $out = (string) ($out[0] ?? '');
            }
            if ($out === '') {
                api_error('Video finished but no output URL was returned.', 502);
            }
            api_out(finalize_video($out, [
                'prompt' => (string) ($_GET['prompt'] ?? ''),
                'style'  => (string) ($_GET['style'] ?? 'none'),
            ]));
        }
        if ($status === 'failed' || $status === 'canceled') {
            $err = $res['body']['error'] ?? 'render failed';
            if (is_array($err)) {
                $err = json_encode($err);
            }
            api_out(['ok' => true, 'status' => 'failed', 'error' => (string) $err]);
        }
        api_out(['ok' => true, 'status' => 'retry']);

    case 'video_free':
        // Free text-to-video, no card: Pollinations when a (free) key is
        // saved, otherwise the keyless Okatsu txt2video (the WhatsApp bots'
        // `.sora` engine) as a best-effort fallback. Same style handling as
        // the Replicate path; the render blocks until the MP4 is back, then
        // it is validated and recorded in history like any other.
        ensure_dirs();
        $prompt = trim((string) ($_POST['prompt'] ?? ''));
        if ($prompt === '') {
            api_error('Please describe the video you want to create.');
        }
        $style = $_POST['style'] ?? 'none';
        $styleTemplates = load_style_templates();
        if (!isset(STYLES[$style]) && !isset($styleTemplates[$style])) {
            $style = 'none';
        }
        if (isset($styleTemplates[$style])) {
            $prompt = render_style_template($styleTemplates[$style], $prompt);
        } elseif (isset(STYLES[$style]) && $style !== 'none') {
            $prompt = $prompt . ', ' . STYLES[$style][0];
        }
        if (mb_strlen($prompt) > 1000) {
            $prompt = mb_substr($prompt, 0, 1000);
        }

        // 1) Pollinations (free key saved) — reliable, open-source.
        $secrets = load_secrets();
        if (($secrets['pollinations_key'] ?? '') !== '') {
            $bin = pollinations_video_bytes($prompt, $secrets['pollinations_key']);
            if ($bin !== '') {
                api_out(finalize_video_bytes($bin, ['prompt' => $prompt, 'style' => $style], 'pollinations'));
            }
        }

        // 2) Keyless fallback: the Okatsu txt2video endpoint (bots' .sora).
        $videoUrl = free_txt2video($prompt);
        if ($videoUrl !== '') {
            api_out(finalize_video($videoUrl, ['prompt' => $prompt, 'style' => $style], 'okatsu'));
        }

        api_error(
            'The free video services did not return a video. ' .
            'Add a free Pollinations key (no credit card — enter.pollinations.ai) ' .
            'in Video mode, or switch to the Replicate engine.',
            502
        );

    case 'pollikey':
        // Free Pollinations key for the free video engine. Stored outside
        // the web root like the other secrets.
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $key = trim((string) ($_POST['key'] ?? ''));
            if ($key === '') {
                api_error('Enter your Pollinations API key (starts with pk_ or sk_).');
            }
            if (strlen($key) < 10 || !preg_match('/^(pk|sk)_[A-Za-z0-9._-]+$/', $key)) {
                api_error('That does not look like a Pollinations API key (should start with pk_ or sk_).');
            }
            save_secret('pollinations_key', $key);
            api_out(['ok' => true, 'saved' => true]);
        }
        $cfg = load_secrets();
        api_out(['ok' => true, 'has_key' => ($cfg['pollinations_key'] ?? '') !== '']);

    case 'styles':
        // Full style list for the dropdown: tuned suffix styles + Perchance templates.
        $items = [];
        foreach (STYLES as $key => $info) {
            $items[$key] = STYLE_LABELS[$key] ?? $key;
        }
        foreach (load_style_templates() as $key => $tpl) {
            $items[$key] = $key;     // display name = key (e.g. 'Painted Anime')
        }
        api_out(['ok' => true, 'items' => $items, 'total' => count($items)]);

    case 'voices':
        // Curated TTS voices for Story mode (live list, cached 24h).
        ensure_dirs();
        $cacheFile = DATA_DIR . '/voices.json';
        $items = null;
        if (is_file($cacheFile) && time() - filemtime($cacheFile) < 86400) {
            $decoded = json_decode((string) file_get_contents($cacheFile), true);
            if (is_array($decoded) && $decoded) {
                $items = $decoded;
            }
        }
        if ($items === null) {
            $items = fetch_edge_voices();
            if ($items) {
                file_put_contents($cacheFile, json_encode($items, JSON_UNESCAPED_SLASHES));
            }
        }
        if (!$items) {
            $items = fallback_voices();
        }
        api_out(['ok' => true, 'items' => $items, 'total' => count($items)]);

    case 'tts':
        // Free text-to-speech for Story mode. Cached on disk.
        ensure_dirs();
        $text  = trim((string) ($_POST['text'] ?? ''));
        $voice = preg_replace('/[^A-Za-z0-9\-]/', '', (string) ($_POST['voice'] ?? 'en-US-ChristopherNeural'));
        $rate  = (string) ($_POST['rate'] ?? '+0%');
        if (!preg_match('/^[+-]?\d+%$/', $rate)) {
            $rate = '+0%';
        }
        if ($text === '' || mb_strlen($text) > 2000) {
            api_error('Text is empty or too long (max 2000 characters).');
        }
        if ($voice === '' || !preg_match('/^[A-Za-z]{2,3}-[A-Za-z]{2}-[A-Za-z]+$/', $voice)) {
            api_error('Invalid voice.');
        }
        $lang     = voice_lang($voice);
        $cacheKey = md5($voice . '|' . $rate . '|' . $text);
        $file     = TTS_DIR . '/' . $cacheKey . '.mp3';
        if (!is_file($file)) {
            $bin = edge_tts_speak($text, $voice, $rate, '+0Hz', $lang);
            $engine = 'edge';
            if ($bin === null) {
                $bin    = gtts_speak($text, $lang);
                $engine = 'gtts';
            }
            if ($bin === null || strlen($bin) < 1000) {
                api_error('Voice synthesis failed — the free TTS service is busy. Try again in a moment.', 502);
            }
            file_put_contents($file, $bin);
            api_out(['ok' => true, 'url' => 'data/tts/' . rawurlencode($cacheKey) . '.mp3', 'engine' => $engine, 'cached' => false]);
        }
        api_out(['ok' => true, 'url' => 'data/tts/' . rawurlencode($cacheKey) . '.mp3', 'engine' => 'cache', 'cached' => true]);

    case 'story_upload':
        // Receive the browser-rendered WebM and add it to history as a video.
        ensure_dirs();
        $bin = file_get_contents('php://input');
        if ($bin === false || strlen($bin) < 5000) {
            api_error('No video data received.', 400);
        }
        // Integrity: WebM files start with the EBML magic bytes.
        if (substr($bin, 0, 4) !== "\x1A\x45\xDF\xA3") {
            api_error('Uploaded data is not a valid WebM video.', 400);
        }
        $id   = date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
        $file = $id . '.webm';
        file_put_contents(VIDEO_DIR . '/' . $file, $bin);

        $entry = [
            'id'          => $id,
            'type'        => 'video',
            'file'        => $file,
            'hash'        => hash('sha256', $bin),
            'prompt'      => '📖 Story video · ' . (int) ($_GET['scenes'] ?? 0) . ' scenes',
            'prompt_orig' => mb_substr((string) ($_GET['title'] ?? ''), 0, 120),
            'style'       => 'story',
            'seed'        => 0,
            'resolution'  => (string) ($_GET['aspect'] ?? '16:9'),
            'created'     => date('c'),
        ];

        $history = load_history();
        array_unshift($history, $entry);
        save_history(array_slice($history, 0, 500));
        api_out(['ok' => true, 'entry' => $entry, 'url' => 'data/videos/' . rawurlencode($file)]);

    case 'upload3d':
        // Receive a browser-rendered 3D parallax WebM and add it to history.
        ensure_dirs();
        $bin = file_get_contents('php://input');
        if ($bin === false || strlen($bin) < 5000) {
            api_error('No video data received.', 400);
        }
        // Integrity: WebM files start with the EBML magic bytes.
        if (substr($bin, 0, 4) !== "\x1A\x45\xDF\xA3") {
            api_error('Uploaded data is not a valid WebM video.', 400);
        }
        $id   = date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
        $file = $id . '.webm';
        file_put_contents(VIDEO_DIR . '/' . $file, $bin);

        $entry = [
            'id'          => $id,
            'type'        => 'video',
            'file'        => $file,
            'hash'        => hash('sha256', $bin),
            'prompt'      => '🌀 3D animation · ' . preg_replace('/[^a-z0-9 ]/i', '', (string) ($_GET['mode'] ?? 'auto')) . ' depth',
            'prompt_orig' => mb_substr((string) ($_GET['title'] ?? '3D animation'), 0, 120),
            'style'       => '3d',
            'seed'        => 0,
            'resolution'  => (string) ($_GET['aspect'] ?? '16:9'),
            'created'     => date('c'),
        ];

        $history = load_history();
        array_unshift($history, $entry);
        save_history(array_slice($history, 0, 500));
        api_out(['ok' => true, 'entry' => $entry, 'url' => 'data/videos/' . rawurlencode($file)]);

    case 'generate':
        ensure_dirs();
        $prompt = sanitize_prompt((string) ($_POST['prompt'] ?? ''));
        if ($prompt === '') {
            api_error('Please describe the image you want to create.');
        }
        if (mb_strlen($prompt) > 2000) {
            api_error('Prompt is too long (max 2000 characters).');
        }

        $style          = sanitize_style((string) ($_POST['style'] ?? 'none'));
        $styleTemplates = load_style_templates();
        if (!isset(STYLES[$style]) && !isset($styleTemplates[$style])) {
            $style = 'none';
        }

        // Resolution: a preset key (square/portrait/landscape) maps to a fixed
        // dims string; 'custom' reads res_w/res_h, snaps them to 64px multiples
        // in the engine's native 256-768 range, and pre-computes a canonical
        // fallback in case the free engine rejects the custom size.
        $resolution = sanitize_resolution((string) ($_POST['resolution'] ?? 'square'));
        $resMap     = array_map(static fn ($r) => $r[1], RESOLUTIONS); // keyed by option (square/portrait/landscape)
        $fallbackDims = '';
        if ($resolution === 'custom') {
            $w = (int) ($_POST['res_w'] ?? 768);
            $h = (int) ($_POST['res_h'] ?? 768);
            if ($w < 64) $w = 768;
            if ($h < 64) $h = 768;
            $dims  = snap_resolution_dims($w, $h);
            $fb    = nearest_supported_dims($w, $h);
            // Only fall back when the requested size is not already canonical.
            if ($fb !== $dims) {
                $fallbackDims = $fb;
            }
        } else {
            if (!isset($resMap[$resolution])) {
                $resolution = 'square';
            }
            $dims = $resMap[$resolution];
        }

        $guidance = (float) ($_POST['guidance'] ?? 7);
        $guidance = max(1, min(20, $guidance));

        $seed = (int) ($_POST['seed'] ?? -1);
        if ($seed < 0) {
            $seed = -1;
        }

        $negative = trim((string) ($_POST['negative'] ?? ''));

        // Optional reference image (img2img). Sent as a data URL — the client
        // downscales it, so it stays small. Validated strictly.
        $refUrl  = trim((string) ($_POST['ref_url'] ?? ''));
        // The service expects blur between 0 and 1 (0 = keep the reference,
        // 1 = full freedom). The UI slider is 0-100 and sends value/100.
        $refBlur = (float) ($_POST['ref_blur'] ?? 0.5);
        $refBlur = max(0, min(1, $refBlur));
        if ($refUrl !== '') {
            if (!preg_match('#^data:image/(jpeg|png|webp|gif);base64,#i', $refUrl)) {
                api_error('Reference image must be a raster image data URL (JPEG/PNG/WebP/GIF).');
            }
            if (strlen($refUrl) > 4 * 1024 * 1024) {
                api_error('Reference image is too large (max 4 MB after downscaling).');
            }
        }
        // Engine routing for reference requests. Local repaints never reach
        // this endpoint (they are rendered in the browser and saved through
        // action=repaint_save). "free" runs the keyless Perchance img2img
        // path (referenceImage field, no token); "ai" runs a real img2img
        // model via the user's HF token.
        $engine = (string) ($_POST['engine'] ?? 'local');
        if ($refUrl !== '' && $engine !== 'ai' && $engine !== 'free') {
            api_error('Local repaints are rendered in your browser. Choose “🆓 Free img2img” (keyless) or “✨ AI Repaint” (HuggingFace token).');
        }

        // Same-request short-circuit: if this exact generation (seed, raw
        // prompt, style, resolution, no reference) was already saved, return
        // the saved copy without calling the service again. Skipped when a
        // reference image is used — with img2img the reference is the point.
        if ($seed >= 0 && $refUrl === '') {
            $dup = find_history_by_key([
                'seed'       => $seed,
                'style'      => $style,
                'resolution' => $dims,
                'prompt'     => $prompt,
                'ref'        => false,
            ], IMG_DIR);
            if ($dup !== null) {
                api_out([
                    'ok'        => true,
                    'image'     => $dup,
                    'url'       => 'data/images/' . rawurlencode((string) $dup['file']),
                    'duplicate' => true,
                ]);
            }
        }

        // Apply the selected style.
        if (isset($styleTemplates[$style])) {
            // Perchance-style prompt template ({{DESC}} replaced with the prompt).
            $fullPrompt   = render_style_template($styleTemplates[$style], $prompt);
            $fullNegative = trim($negative);
        } else {
            // Tuned suffix style: append style text to the prompt/negative.
            [$posSuffix, $negSuffix] = STYLES[$style];
            $fullPrompt   = $posSuffix !== '' ? $prompt . ', ' . $posSuffix : $prompt;
            $negParts     = array_values(array_filter([$negative, $negSuffix], static fn ($p) => trim((string) $p) !== ''));
            $fullNegative = implode(', ', $negParts);
        }

        // "No style" must stay bare on the positive side, but with an empty (or
        // anatomy-only) negative the model drifts into anime/illustration. Merge
        // the neutral anti-stylization block in — the user's own negative tokens
        // are always kept first.
        if ($style === 'none') {
            $noneParts    = array_values(array_filter([$fullNegative, BASE_NEGATIVE], static fn ($p) => trim((string) $p) !== ''));
            $fullNegative = implode(', ', $noneParts);
        }

        // AI repaint (img2img) via the user's HuggingFace token.
        if ($refUrl !== '' && $engine === 'ai') {
            $hf = load_video_config();
            if ($hf['hf_key'] === '') {
                api_error('AI Repaint needs a HuggingFace token — add one in Settings (free: huggingface.co/settings/tokens).', 401);
            }
            $bin = hf_img2img($fullPrompt, $refUrl, $refBlur, $hf);
            api_out(save_generated_bytes($bin, [
                'prompt'      => $fullPrompt,
                'prompt_orig' => $prompt,
                'negative'    => $fullNegative,
                'style'       => $style,
                'seed'        => $seed,
            ]));
        }

        // "free" engine falls through here: generate_image() sends the
        // reference to the keyless Perchance img2img path (referenceImage
        // field) with blur acting as match strength.
        $result = generate_image([
            'prompt'       => $fullPrompt,
            'prompt_orig'  => $prompt,
            'negative'     => $fullNegative,
            'style'        => $style,
            'resolution'   => $dims,
            'fallback_dims'=> $fallbackDims, // custom sizes: retry at a canonical size if the engine rejects
            'guidance'     => $guidance,
            'seed'         => $seed,
            'ref_url'      => $refUrl,
            'ref_blur'     => $refBlur,
            'sync'         => ($_POST['sync'] ?? '') === '1',
        ]);
        api_out($result);

    case 'history':
        ensure_dirs();
        $history = load_history();
        foreach ($history as &$entry) {
            $sub  = ($entry['type'] ?? '') === 'video' ? 'videos' : 'images';
            $dir  = $sub === 'videos' ? VIDEO_DIR : IMG_DIR;
            $file = $dir . '/' . basename((string) $entry['file']);
            // Fast-path images may still be saving — show the signed URL until
            // the local copy exists so the gallery never has a broken tile.
            if ($sub === 'images' && !is_file($file) && !empty($entry['remote'])) {
                $entry['url'] = $entry['remote'];
            } else {
                $entry['url'] = 'data/' . $sub . '/' . rawurlencode((string) $entry['file']);
            }
        }
        unset($entry);
        api_out(['ok' => true, 'items' => $history]);

    case 'delete':
        $id = (string) ($_POST['id'] ?? '');
        $entry = history_entry($id);
        if ($entry === null) {
            api_error('That item is not in the history.', 404);
        }
        $sub  = ($entry['type'] ?? '') === 'video' ? VIDEO_DIR : IMG_DIR;
        $file = $sub . '/' . basename((string) $entry['file']);
        if (is_file($file)) {
            @unlink($file);
        }
        $history = load_history();
        $history = array_values(array_filter($history, static fn ($e) => ($e['id'] ?? '') !== $id));
        save_history($history);
        api_out(['ok' => true, 'deleted' => $id]);

    case 'download':
        $id    = (string) ($_GET['id'] ?? '');
        $entry = history_entry($id);
        if ($entry === null) {
            api_error('That item is not in the history.', 404);
        }
        $sub  = ($entry['type'] ?? '') === 'video' ? VIDEO_DIR : IMG_DIR;
        $file = $sub . '/' . basename((string) $entry['file']);
        if (!is_file($file) && $sub === IMG_DIR) {
            // Fast-path entry that hasn't finished saving yet — materialise it
            // from its signed URL on demand so downloads always work.
            $file = ensure_image_file($entry);
        }
        if (!is_file($file)) {
            api_error('File is missing from disk.', 404);
        }
        $ext  = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $mime = ['png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif', 'mp4' => 'video/mp4', 'webm' => 'video/webm'][$ext] ?? 'image/jpeg';
        header('Content-Type: ' . $mime);
        header('Content-Disposition: attachment; filename="pixelforge-' . $id . '.' . $ext . '"');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        exit;

    case 'download_all':
        // ZIP the selected images into one download (ids: comma-separated).
        $idsRaw = (string) ($_POST['ids'] ?? $_GET['ids'] ?? '');
        $ids    = array_values(array_unique(array_filter(array_map('trim', explode(',', $idsRaw)), 'strlen')));
        if (!$ids) {
            api_error('No images selected to download.');
        }
        if (!class_exists('ZipArchive')) {
            api_error('ZIP support is not enabled on this server.', 501);
        }

        $history = load_history();
        $byId    = [];
        foreach ($history as $e) {
            $byId[(string) ($e['id'] ?? '')] = $e;
        }
        $picked = [];
        foreach ($ids as $id) {
            if (isset($byId[$id])) {
                $picked[$id] = $byId[$id];
            }
        }
        if (!$picked) {
            api_error('None of the selected images exist in history.', 404);
        }

        $zipPath = tempnam(sys_get_temp_dir(), 'pfzip_');
        if ($zipPath === false) {
            api_error('Could not create a temporary zip file.', 500);
        }
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            @unlink($zipPath);
            api_error('Could not create the zip archive.', 500);
        }

        $added = 0;
        foreach ($picked as $e) {
            $sub  = ($e['type'] ?? '') === 'video' ? VIDEO_DIR : IMG_DIR;
            $file = $sub . '/' . basename((string) $e['file']);
            if (!is_file($file) && $sub === IMG_DIR) {
                // Pending fast-path entry — materialise it from its signed URL.
                $file = ensure_image_file($e);
            }
            if (!is_file($file)) {
                continue;
            }
            $ext     = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            $zipName = 'pixelforge-' . (string) $e['id'] . ($ext !== '' ? '.' . $ext : '');
            if ($zip->addFile($file, $zipName)) {
                $added++;
            }
        }
        $zip->close();

        if ($added === 0) {
            @unlink($zipPath);
            api_error('The selected image files are missing from disk.', 404);
        }

        $stamp = date('Ymd_His');
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="pixelforge-batch-' . $stamp . '.zip"');
        header('Content-Length: ' . filesize($zipPath));
        readfile($zipPath);
        @unlink($zipPath);
        exit;

    case 'clear_all':
        // Wipe the whole gallery: delete every saved file (images + videos) + history rows.
        $history = load_history();
        $removed = 0;
        foreach ($history as $e) {
            $sub  = ($e['type'] ?? '') === 'video' ? VIDEO_DIR : IMG_DIR;
            $file = $sub . '/' . basename((string) ($e['file'] ?? ''));
            if (is_file($file) && @unlink($file)) {
                $removed++;
            }
        }
        save_history([]);
        api_out(['ok' => true, 'cleared' => count($history), 'removed' => $removed]);

    case 'verify':
        // Integrity check: re-hash the file on disk and compare with the
        // checksum recorded when it was saved. Detects later mutation.
        $id = (string) ($_GET['id'] ?? '');
        $entry = history_entry($id);
        if ($entry === null) {
            api_error('That item is not in the history.', 404);
        }
        $sub      = ($entry['type'] ?? '') === 'video' ? VIDEO_DIR : IMG_DIR;
        $file     = $sub . '/' . basename((string) $entry['file']);
        $expected = (string) ($entry['hash'] ?? '');
        if (!is_file($file)) {
            api_out(['ok' => true, 'id' => $id, 'exists' => false, 'status' => 'missing']);
        }
        $actual = hash_file('sha256', $file);
        if ($expected === '') {
            api_out(['ok' => true, 'id' => $id, 'exists' => true, 'status' => 'unverified', 'hash' => $actual]);
        }
        api_out([
            'ok'     => true,
            'id'     => $id,
            'exists' => true,
            'status' => hash_equals($expected, $actual) ? 'intact' : 'mutated',
            'hash'   => $actual,
        ]);

    case 'setkey':
        // Advanced: manually paste a session key (obtained from your own
        // browser's devtools while using perchance.org).
        $manual = strtolower(trim((string) ($_POST['key'] ?? '')));
        if ($manual !== '' && !preg_match('/^[a-f0-9]{64}$/i', $manual)) {
            api_error('That key does not look valid (must be 64 hex characters).');
        }
        save_key_file(['manual' => $manual]);
        api_out(['ok' => true, 'key' => $manual !== '' ? 'manual' : 'auto']);

    default:
        api_error('Unknown action.', 404);
}
