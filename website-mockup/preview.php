<?php
/* ============================================================
   MOCKUPGEN — preview.php
   Server-side proxy: fetches the target site's HTML and returns it
   so the device iframes can render any website (bypasses CORS).
   Relative asset URLs are resolved by injecting a <base> tag.
   ============================================================ */

// Only plain HTTP responses — the iframes just render what we return.
$raw_url = isset($_GET['url']) ? trim($_GET['url']) : '';
if ($raw_url === '') {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    exit('// NO_URL_SUPPLIED');
}

// Normalize: require http/https
$scheme = strtolower((string) parse_url($raw_url, PHP_URL_SCHEME));
if (!in_array($scheme, ['http', 'https'], true)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    exit('// INVALID_SCHEME — http/https only');
}

$host = (string) parse_url($raw_url, PHP_URL_HOST);
if ($host === '') {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    exit('// INVALID_URL');
}

// Rebuild the URL (keeps port, path, query, fragment dropped).
$port = parse_url($raw_url, PHP_URL_PORT);
$path = (string) parse_url($raw_url, PHP_URL_PATH);
if ($path === '') { $path = '/'; }
$query = parse_url($raw_url, PHP_URL_QUERY);
$url = $scheme . '://' . $host . ($port ? ':' . $port : '') . $path . ($query !== null ? '?' . $query : '');

// Base URL for <base> injection (scheme://host[:port]/dirname/)
$base = $scheme . '://' . $host . ($port ? ':' . $port : '');
$dir = rtrim(dirname($path), '/');
$base = $base . ($dir === '' || $dir === '/' ? '/' : $dir . '/');

// SSRF guard — this tool is built to run on a local XAMPP box, and previewing
// your own localhost/LAN sites is its main job, so loopback + private ranges
// are allowed by default, and so are public sites. The only target we refuse
// is the cloud instance-metadata endpoint (the one thing that's dangerous
// even on a LAN). If you ever deploy this publicly, tighten this up to block
// all non-public ranges.
$host_l = strtolower($host);

// Resolve so a name like "localhost", "mysite.local" or a LAN machine name is
// judged by its actual address, not just the literal string.
$resolved = @gethostbyname($host_l);

if ($host_l === '169.254.169.254' || $resolved === '169.254.169.254'
    || $host_l === 'metadata.google.internal') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit('// BLOCKED_HOST');
}

if (!function_exists('curl_init')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('// CURL_NOT_AVAILABLE');
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER   => true,
    CURLOPT_FOLLOWLOCATION   => true,
    CURLOPT_MAXREDIRS        => 5,
    CURLOPT_CONNECTTIMEOUT   => 10,
    CURLOPT_TIMEOUT          => 20,
    CURLOPT_USERAGENT        => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    CURLOPT_SSL_VERIFYPEER   => false,
    CURLOPT_SSL_VERIFYHOST   => 0,
    CURLOPT_ENCODING         => '',
    CURLOPT_MAXFILESIZE      => 8 * 1024 * 1024, // 8MB cap
    CURLOPT_HTTPHEADER       => [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.9',
    ],
]);
$html = curl_exec($ch);
$errno = curl_errno($ch);
$http_code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$content_type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($html === false || $errno !== 0) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    exit('// FETCH_FAILED err=' . $errno);
}

// Pass through non-HTML (images, pdf) as-is so iframes can still render them.
if (stripos($content_type, 'text/html') === false) {
    $type = $content_type !== '' ? $content_type : 'application/octet-stream';
    header('Content-Type: ' . $type);
    header('Content-Length: ' . strlen($html));
    echo $html;
    exit;
}

// Resolve relative assets: inject <base href="..."> right after <head>.
$base_tag = '<base href="' . htmlspecialchars($base, ENT_QUOTES, 'UTF-8') . '">';
if (preg_match('/<head[^>]*>/i', $html, $m, PREG_OFFSET_CAPTURE)) {
    $pos = $m[0][1] + strlen($m[0][0]);
    $html = substr($html, 0, $pos) . $base_tag . substr($html, $pos);
} else {
    // No <head>: inject at the very top of <html> (or start of doc).
    $html = '<head>' . $base_tag . '</head>' . $html;
}

// Prevent the target's own CSP/XFO headers from mattering: we only send ours.
header('Content-Type: text/html; charset=utf-8');
// Allow embedding in our own page (same origin), block elsewhere.
header('Content-Security-Policy: frame-ancestors \'self\'');
header('X-Frame-Options: SAMEORIGIN');
echo $html;
