<?php
/**
 * SiteRipper — export a live website (or WordPress demo) into an editable
 * static project you can host or customise locally.
 *
 * - Crawls same-host pages (BFS) with depth + page limits
 * - Mirrors HTML/CSS/JS/images/fonts/media to a local folder
 * - Rewrites absolute URLs to relative paths (offline-safe)
 * - Rewrites url()/@import inside CSS and downloads those assets
 * - Optional: external-host assets, media, robots.txt respect
 * - Local folder / downloaded template import mode
 * - ZIP export, progress state (for web UI), CLI entry point
 *
 * Runs locally. Only use on sites you have permission to export.
 */

declare(strict_types=1);

if (!defined('RIPPER_JOBS_DIR')) {
    define('RIPPER_JOBS_DIR', __DIR__ . '/../jobs');
}

final class SiteRipper
{
    public const VERSION = '1.1.0';
    public const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SiteRipper/1.0';
    /** Clean browser UA used when falling back to the OS curl binary. */
    private const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

    /** Extensions we treat as downloadable assets. */
    private const ASSET_EXTS = [
        'css','js','mjs','json','xml','txt','map',
        'png','jpg','jpeg','gif','webp','avif','svg','ico','cur',
        'woff','woff2','ttf','otf','eot',
        'mp4','webm','ogg','ogv','mp3','wav','m4a','aac','pdf','zip','doc','docx','xls','xlsx','ppt','pptx',
    ];

    private string $jobId;
    private string $siteDir;
    private array $options;
    private array $state = [];
    private ?string $robotsTxt = null;

    public function __construct(string $jobId, array $options = [])
    {
        $this->jobId = preg_replace('/[^A-Za-z0-9_\-]/', '', $jobId);
        if ($this->jobId === '') {
            $this->jobId = 'job-' . substr(bin2hex(random_bytes(4)), 0, 8);
        }
        $this->options = array_merge([
            'max_pages'        => 100,
            'max_depth'        => 5,
            'external_assets'  => false,
            'download_media'   => true,
            'respect_robots'   => false,
            'speed'            => 'balanced',
        ], $options);
        $this->options['max_pages'] = max(1, min(2000, (int) $this->options['max_pages']));
        $this->options['max_depth'] = max(1, min(25, (int) $this->options['max_depth']));
        $this->applySpeed();

        $this->siteDir = self::normalizePath(RIPPER_JOBS_DIR . '/' . $this->jobId . '/site');
    }

    /* ------------------------------------------------------------------ */
    /* Public API                                                          */
    /* ------------------------------------------------------------------ */

    /** Create the job. $target is a URL or a local folder/file path. */
    public function start(string $target): array
    {
        $target = trim($target);

        if (is_dir($target) || is_file($target)) {
            return $this->startFromFolder($target);
        }

        $url = $this->normalizeUrl($target);
        if ($url === '') {
            throw new RuntimeException('That does not look like a URL or a local folder.');
        }

        $p  = parse_url($url);
        $scheme = strtolower($p['scheme'] ?? 'https');
        $host   = strtolower($p['host'] ?? '');
        if ($host === '' || !in_array($scheme, ['http', 'https'], true)) {
            throw new RuntimeException('That does not look like a valid URL (http/https only).');
        }

        // strip fragment, keep query
        $port = isset($p['port']) ? ':' . (int) $p['port'] : '';
        $url = $scheme . '://' . $host . $port . ($p['path'] ?? '') . (isset($p['query']) && $p['query'] !== '' ? '?' . $p['query'] : '');
        if (!isset($p['path']) || $p['path'] === '') {
            $url .= '/';
        }

        $this->state = [
            'job_id'      => $this->jobId,
            'mode'        => 'url',
            'start_url'   => $url,
            'host'        => $host,
            'port'        => isset($p['port']) ? (int) $p['port'] : null,
            'scheme'      => $scheme,
            'options'     => $this->options,
            'queue'       => [['url' => $url, 'depth' => 0]],
            'visited'     => [],
            'pages'       => 0,
            'assets'      => 0,
            'bytes'       => 0,
            'failed'      => [],
            'status'      => 'running',
            'message'     => 'Starting…',
            'started_at'  => time(),
            'finished_at' => null,
        ];

        $this->saveState();
        $this->mkdir($this->siteDir);
        return $this->state;
    }

    /** Run up to $n queue items (pages). Returns current state. */
    public function runBatch(int $n = 8): array
    {
        if (($this->state['status'] ?? '') !== 'running') {
            return $this->state;
        }

        for ($i = 0; $i < $n; $i++) {
            if (empty($this->state['queue'])) {
                break;
            }
            $item = array_shift($this->state['queue']);
            $this->processPage($item['url'], (int) $item['depth']);
            if (count($this->state['visited']) >= $this->options['max_pages'] && !empty($this->state['queue'])) {
                // drain queue but stop after the page limit for crawled pages
                break;
            }
        }

        if (empty($this->state['queue'])) {
            $this->finish();
        } elseif (count($this->state['visited']) >= $this->options['max_pages']) {
            // page limit reached — stop crawling new pages
            $this->state['message'] = 'Page limit (' . $this->options['max_pages'] . ') reached — stopping crawl.';
            $this->finish();
        }

        $this->saveState();
        return $this->state;
    }

    /** Mark job finished + write report. */
    public function finish(): void
    {
        $this->state['status']      = 'done';
        $this->state['finished_at'] = time();
        $this->state['message']     = 'Export complete.';
        $this->saveState();
        $this->writeReport();
    }

    public function getState(): array
    {
        return $this->state;
    }

    public function getSiteDir(): string
    {
        return $this->siteDir;
    }

    public function getJobId(): string
    {
        return $this->jobId;
    }

    /** Create a ZIP of the exported site. Returns path or null. */
    public function createZip(): ?string
    {
        if (!class_exists('ZipArchive')) {
            return null;
        }
        $zipPath = RIPPER_JOBS_DIR . '/' . $this->jobId . '/export.zip';
        @unlink($zipPath);

        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            return null;
        }
        $this->addDirToZip($zip, $this->siteDir, '');
        $zip->close();
        return $zipPath;
    }

    /* ------------------------------------------------------------------ */
    /* Local folder import                                                 */
    /* ------------------------------------------------------------------ */

    private function startFromFolder(string $path): array
    {
        $this->mkdir($this->siteDir);
        $files = 0;

        if (is_file($path)) {
            $dest = $this->siteDir . '/index.html';
            copy($path, $dest);
            $files = 1;
        } else {
            $files = $this->copyTree($path, $this->siteDir);
        }

        $this->state = [
            'job_id'      => $this->jobId,
            'mode'        => 'folder',
            'start_url'   => $path,
            'host'        => '',
            'scheme'      => '',
            'options'     => $this->options,
            'queue'       => [],
            'visited'     => [],
            'pages'       => $files,
            'assets'      => 0,
            'bytes'       => $this->dirSize($this->siteDir),
            'failed'      => [],
            'status'      => 'done',
            'message'     => 'Local folder imported (' . $files . ' files).',
            'started_at'  => time(),
            'finished_at' => time(),
        ];
        $this->saveState();
        $this->writeReport();
        return $this->state;
    }

    /* ------------------------------------------------------------------ */
    /* Crawling                                                            */
    /* ------------------------------------------------------------------ */

    private function processPage(string $url, int $depth): void
    {
        if (isset($this->state['visited'][$url])) {
            return;
        }
        $this->state['visited'][$url] = true;

        if ($this->options['respect_robots'] && !$this->robotsAllowed($url)) {
            return; // silently skip
        }

        $res = $this->fetch($url);
        if ($res === null) {
            $this->state['failed'][] = ['url' => $url, 'error' => 'fetch failed'];
            return;
        }

        $isHtml = $this->isHtml($res['content_type'], $res['body']);
        $path   = $this->mapUrlToPath($url, $isHtml);

        // Guard: never write outside siteDir
        $full = $this->siteDir . '/' . $path;
        $fullNorm = self::normalizePath($full);
        if (!str_starts_with($fullNorm, rtrim($this->siteDir, '/') . '/')) {
            $this->state['failed'][] = ['url' => $url, 'error' => 'path traversal blocked'];
            return;
        }
        $full = $fullNorm;

        $this->mkdir(dirname($full));
        $written = @file_put_contents($full, $res['body']);
        if ($written === false) {
            $this->state['failed'][] = ['url' => $url, 'error' => 'could not write file'];
            return;
        }

        $this->state['bytes'] += $written;

        if ($isHtml) {
            $this->state['pages']++;
            $this->curDepth = $depth;
            $rewritten = $this->rewriteHtml($res['body'], $url, $path);
            @file_put_contents($full, $rewritten);

            if ($depth < $this->options['max_depth']) {
                $this->collectLinks($res['body'], $url, $depth + 1);
            }
        } else {
            // asset fetched directly from queue (rare) — count as asset
            $this->state['assets']++;
            if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'css') {
                $this->rewriteCssFile($full, $url, $path);
            }
        }
    }

    /** Parse HTML for same-host links and enqueue them. */
    private function collectLinks(string $html, string $pageUrl, int $depth): void
    {
        $doc = $this->loadDom($html);
        if ($doc === null) {
            return;
        }

        $seen = [];
        $xp = new DOMXPath($doc);
        $nodes = $xp->query('//a[@href] | //iframe[@src]');
        if ($nodes === false) {
            return;
        }
        foreach ($nodes as $node) {
            $attr = $node->hasAttribute('href') ? 'href' : 'src';
            $href = trim((string) $node->getAttribute($attr));
            $abs  = $this->resolveUrl($pageUrl, $href);
            if ($abs === '' || isset($seen[$abs])) {
                continue;
            }
            $seen[$abs] = true;
            if (!$this->isSameHost($abs) || !$this->looksLikePage($abs)) {
                continue;
            }
            $this->enqueue($abs, $depth);
        }
    }

    private function enqueue(string $url, int $depth): bool
    {
        if ($depth > $this->options['max_depth']) {
            return false;
        }
        if (count($this->state['visited']) >= $this->options['max_pages']) {
            return false;
        }
        $key = $url;
        if (isset($this->state['visited'][$key])) {
            return false;
        }
        foreach ($this->state['queue'] as $q) {
            if ($q['url'] === $key) {
                return false;
            }
        }
        $this->state['queue'][] = ['url' => $key, 'depth' => $depth];
        return true;
    }

    /* ------------------------------------------------------------------ */
    /* HTML rewriting                                                      */
    /* ------------------------------------------------------------------ */

    private function rewriteHtml(string $html, string $pageUrl, string $pagePath): string
    {
        $doc = $this->loadDom($html);
        if ($doc === null) {
            return $html;
        }

        // remove <base> tags — they would break our relative resolution
        $xp = new DOMXPath($doc);
        $bases = $xp->query('//base');
        if ($bases !== false) {
            foreach ($bases as $b) {
                $b->parentNode?->removeChild($b);
            }
        }

        $selectors = [
            '//a[@href]',
            '//link[@href]',
            '//script[@src]',
            '//img[@src]',
            '//source[@src]',
            '//video[@poster]',
            '//video[@src]',
            '//audio[@src]',
            '//iframe[@src]',
            '//*[@data-src]',
            '//*[@data-original]',
            '//*[@data-lazy]',
            '//*[@data-bg]',
            '//*[@srcset]',
            '//meta[@content]',
        ];
        $query = implode(' | ', $selectors);

        foreach ($xp->query($query) as $node) {
            $tag = strtolower($node->nodeName ?? '');

            // meta og:image / twitter:image / og:url
            if ($tag === 'meta') {
                $prop = strtolower((string) $node->getAttribute('property'));
                $name = strtolower((string) $node->getAttribute('name'));
                $content = trim((string) $node->getAttribute('content'));
                if (in_array($prop, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image'], true) && $content !== '') {
                    $node->setAttribute('content', $this->rewriteRef($content, $pageUrl, $pagePath));
                } elseif (($prop === 'og:url' || $name === 'twitter:url') && $content !== '') {
                    $abs = $this->resolveUrl($pageUrl, $content);
                    $local = $this->mapUrlToPath($abs, true);
                    $node->setAttribute('content', $this->relPath($pagePath, $local));
                }
                continue;
            }

            // data-bg often holds "url(...)" or a bare URL
            if ($node->hasAttribute('data-bg')) {
                $val = trim((string) $node->getAttribute('data-bg'));
                if ($val !== '') {
                    $inner = preg_replace('/^url\(\s*[\'"]?|[\'"]?\s*\)$/i', '', $val);
                    if ($inner !== '' && $inner !== $val) {
                        $node->setAttribute('data-bg', 'url(' . $this->rewriteRef($inner, $pageUrl, $pagePath) . ')');
                    } elseif ($val !== '' && strpos($val, 'url(') === false) {
                        $node->setAttribute('data-bg', $this->rewriteRef($val, $pageUrl, $pagePath));
                    }
                }
            }

            // srcset: "url1 1x, url2 2x"
            if ($node->hasAttribute('srcset')) {
                $parts = explode(',', (string) $node->getAttribute('srcset'));
                $out = [];
                foreach ($parts as $part) {
                    $part = trim($part);
                    if ($part === '') {
                        continue;
                    }
                    if (preg_match('/^(\S+)(\s+.*)?$/', $part, $m)) {
                        $urlPart = $m[1];
                        if (strpos($urlPart, 'data:') === 0) {
                            $out[] = $part;
                            continue;
                        }
                        $out[] = $this->rewriteRef($urlPart, $pageUrl, $pagePath) . ($m[2] ?? '');
                    }
                }
                $node->setAttribute('srcset', implode(', ', $out));
            }

            // single URLs
            foreach (['href', 'src', 'poster', 'data-src', 'data-original', 'data-lazy'] as $attr) {
                if (!$node->hasAttribute($attr)) {
                    continue;
                }
                $val = trim((string) $node->getAttribute($attr));
                if ($val === '' || strpos($val, 'data:') === 0 || strpos($val, 'blob:') === 0 || strpos($val, 'javascript:') === 0 || $val[0] === '#' || str_starts_with($val, 'mailto:') || str_starts_with($val, 'tel:')) {
                    continue;
                }
                // only rewrite <a href> for same-host page links; assets via rewriteRef handle it
                $node->setAttribute($attr, $this->rewriteRef($val, $pageUrl, $pagePath));
            }

            // inline style url(...)
            if ($node->hasAttribute('style')) {
                $style = (string) $node->getAttribute('style');
                if (strpos($style, 'url(') !== false) {
                    $node->setAttribute('style', $this->rewriteInlineCss($style, $pageUrl, $pagePath));
                }
            }
        }

        // Remove <link rel="canonical"> pointing at absolute URL (harmless either way, but keep local)
        return $doc->saveHTML();
    }

    /**
     * Decide what a URL reference becomes in the mirrored site.
     * Returns a relative local path, or the original reference if left untouched.
     */
    private function rewriteRef(string $ref, string $pageUrl, string $pagePath): string
    {
        $abs = $this->resolveUrl($pageUrl, $ref);
        if ($abs === '') {
            return $ref;
        }

        if (!$this->isSameHost($abs)) {
            // external host
            if ($this->options['external_assets'] && $this->shouldDownload($abs)) {
                $local = $this->downloadExternalAsset($abs);
                if ($local !== null) {
                    return $this->relPath($pagePath, $local);
                }
            }
            return $ref; // keep absolute external URL
        }

        $isPage = $this->looksLikePage($abs);
        if ($isPage) {
            $local = $this->mapUrlToPath($abs, true);
            if ($this->enqueue($abs, $this->currentDepth() + 1)) {
                return $this->relPath($pagePath, $local);
            }
            // page limit / depth reached — keep the original absolute link
            return $ref;
        }

        if ($this->shouldDownload($abs)) {
            $local = $this->downloadSameHostAsset($abs);
            if ($local !== null) {
                return $this->relPath($pagePath, $local);
            }
        }
        return $ref;
    }

    private function rewriteInlineCss(string $style, string $pageUrl, string $pagePath): string
    {
        return preg_replace_callback('/url\(\s*([\'"]?)(.*?)\1\s*\)/i', function ($m) use ($pageUrl, $pagePath) {
            $ref = trim($m[2]);
            if ($ref === '' || strpos($ref, 'data:') === 0 || $ref[0] === '#') {
                return $m[0];
            }
            return 'url(' . $this->rewriteRef($ref, $pageUrl, $pagePath) . ')';
        }, $style) ?? $style;
    }

    /* ------------------------------------------------------------------ */
    /* CSS rewriting                                                       */
    /* ------------------------------------------------------------------ */

    private function rewriteCssFile(string $file, string $cssUrl, string $cssPath): void
    {
        $css = (string) @file_get_contents($file);
        $new = $this->rewriteCss($css, $cssUrl, $cssPath);
        if ($new !== $css) {
            @file_put_contents($file, $new);
        }
    }

    private function rewriteCss(string $css, string $cssUrl, string $cssPath): string
    {
        $callback = function ($m) use ($cssUrl, $cssPath) {
            $ref = trim($m[1]);
            if ($ref === '' || strpos($ref, 'data:') === 0 || $ref[0] === '#') {
                return $m[0];
            }
            $abs = $this->resolveUrl($cssUrl, $ref);
            if ($abs === '') {
                return $m[0];
            }
            if (!$this->isSameHost($abs)) {
                if ($this->options['external_assets'] && $this->shouldDownload($abs)) {
                    $local = $this->downloadExternalAsset($abs);
                    if ($local !== null) {
                        return 'url("' . $this->relPath($cssPath, $local) . '")';
                    }
                }
                return $m[0];
            }
            $local = $this->downloadSameHostAsset($abs);
            if ($local !== null) {
                return 'url("' . $this->relPath($cssPath, $local) . '")';
            }
            return $m[0];
        };

        // url(...) references
        $css = preg_replace_callback('/url\(\s*([\'"]?)(.*?)\1\s*\)/i', function ($m) use ($callback) {
            return $callback([0 => $m[0], 1 => $m[2]]);
        }, $css) ?? $css;

        // Bare @import "x.css" (without url()) — the url(...) form was already handled above.
        $css = preg_replace_callback('/@import\s+(?!url\()([\'"])([^\'"]+)\1/i', function ($m) use ($callback) {
            $replaced = $callback([0 => $m[0], 1 => $m[2]]);
            if ($replaced === $m[0]) {
                return $m[0];
            }
            return '@import url("' . $replaced . '")';
        }, $css) ?? $css;

        return $css;
    }

    /* ------------------------------------------------------------------ */
    /* Asset downloading                                                   */
    /* ------------------------------------------------------------------ */

    private function downloadSameHostAsset(string $abs): ?string
    {
        $local = $this->mapUrlToPath($abs, false);
        $full  = $this->siteDir . '/' . $local;

        if (is_file($full) && filesize($full) > 0) {
            return $local;
        }

        $res = $this->fetch($abs);
        if ($res === null) {
            $this->state['failed'][] = ['url' => $abs, 'error' => 'asset fetch failed'];
            return null;
        }

        $this->mkdir(dirname($full));
        $written = @file_put_contents($full, $res['body']);
        if ($written === false) {
            return null;
        }
        $this->state['assets']++;
        $this->state['bytes'] += $written;

        if (strtolower(pathinfo($local, PATHINFO_EXTENSION)) === 'css') {
            $this->rewriteCssFile($full, $abs, $local);
        }

        return $local;
    }

    private function downloadExternalAsset(string $abs): ?string
    {
        $p  = parse_url($abs);
        $host = strtolower($p['host'] ?? '');
        if ($host === '' || !preg_match('/^[a-z0-9.\-]+$/', $host)) {
            return null;
        }
        $path = urldecode($p['path'] ?? '/index');
        $path = str_replace(['\\', '..'], ['/', ''], $path);
        $path = ltrim($path, '/');
        $path = preg_replace('#/+#', '/', $path);
        if ($path === '') {
            $path = 'index.html';
        }
        $local = self::normalizePath('external/' . $host . '/' . $path);
        $full  = $this->siteDir . '/' . $local;

        // Guard: never write outside siteDir
        if (!str_starts_with($local, rtrim('external/' . $host, '/') . '/')) {
            return null;
        }

        if (is_file($full) && filesize($full) > 0) {
            return $local;
        }

        $res = $this->fetch($abs);
        if ($res === null) {
            return null;
        }

        $this->mkdir(dirname($full));
        $written = @file_put_contents($full, $res['body']);
        if ($written === false) {
            return null;
        }
        $this->state['assets']++;
        $this->state['bytes'] += $written;

        if (strtolower(pathinfo($local, PATHINFO_EXTENSION)) === 'css') {
            $this->rewriteCssFile($full, $abs, $local);
        }

        return $local;
    }

    private function shouldDownload(string $abs): bool
    {
        $p = parse_url($abs);
        $ext = strtolower(pathinfo($p['path'] ?? '', PATHINFO_EXTENSION));

        if (in_array($ext, ['css', 'js', 'mjs', 'json', 'xml', 'txt', 'map', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'ico', 'cur'], true)) {
            return true;
        }
        if ($this->options['download_media'] && in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm', 'ogg', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'pdf', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'], true)) {
            return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /* URL helpers                                                         */
    /* ------------------------------------------------------------------ */

    /** Track the depth of the page currently being rewritten (for enqueues). */
    private int $curDepth = 0;

    private function currentDepth(): int
    {
        return $this->curDepth;
    }

    private function looksLikePage(string $abs): bool
    {
        $p = parse_url($abs);
        $path = $p['path'] ?? '';
        if ($path === '' || substr($path, -1) === '/') {
            return true;
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        return $ext === '' || in_array($ext, ['html', 'htm', 'php', 'aspx', 'asp', 'shtml', 'jsp', 'cgi'], true);
    }

    private function isSameHost(string $abs): bool
    {
        $p = parse_url($abs);
        $host = strtolower($p['host'] ?? '');
        if ($host === '') {
            return false;
        }
        $start = $this->state['host'] ?? '';
        $sameHost = $host === $start || $host === 'www.' . $start || 'www.' . $host === $start;
        if (!$sameHost) {
            return false;
        }
        // ports must match too (localhost:8391 ≠ localhost:80)
        $port = isset($p['port']) ? (int) $p['port'] : null;
        $startPort = $this->state['port'] ?? null;
        return $port === $startPort;
    }

    private function resolveUrl(string $base, string $ref): string
    {
        $ref = trim($ref);
        if ($ref === '') {
            return '';
        }
        // already absolute?
        if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $ref)) {
            return $ref;
        }
        // protocol-relative
        if (str_starts_with($ref, '//')) {
            $scheme = ($this->state['scheme'] ?? 'https') ?: 'https';
            return $scheme . ':' . $ref;
        }
        // anchor / inline schemes
        if ($ref[0] === '#' || str_starts_with($ref, 'javascript:') || str_starts_with($ref, 'mailto:') || str_starts_with($ref, 'tel:') || str_starts_with($ref, 'data:') || str_starts_with($ref, 'blob:')) {
            return '';
        }

        $b = parse_url($base);
        $scheme = $b['scheme'] ?? ($this->state['scheme'] ?? 'https');
        $host   = $b['host'] ?? ($this->state['host'] ?? '');
        $port   = isset($b['port']) ? ':' . $b['port'] : '';
        $path   = $b['path'] ?? '/';

        if ($ref[0] === '/') {
            return $scheme . '://' . $host . $port . $ref;
        }

        // relative
        $dir = substr($path, 0, (int) strrpos($path, '/') + 1);
        $merged = $dir . $ref;
        // normalize ./ and ../
        $parts = [];
        foreach (explode('/', $merged) as $seg) {
            if ($seg === '.' || $seg === '') {
                continue;
            }
            if ($seg === '..') {
                if ($parts) {
                    array_pop($parts);
                }
                continue;
            }
            $parts[] = $seg;
        }
        return $scheme . '://' . $host . $port . '/' . implode('/', $parts);
    }

    private function normalizeUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        if (!preg_match('#^[a-z][a-z0-9+.\-]*://#i', $url)) {
            if (str_starts_with($url, 'www.')) {
                $url = 'https://' . $url;
            } else {
                $url = 'https://' . $url;
            }
        }
        return $url;
    }

    /** Map an absolute URL to a path under site/. */
    private function mapUrlToPath(string $url, bool $isPage): string
    {
        $p = parse_url($url);
        $path = urldecode($p['path'] ?? '/');
        $path = ltrim($path, '/');
        $path = preg_replace('#/+#', '/', $path);
        if ($path === '') {
            $path = 'index.html';
        }

        if ($isPage) {
            if (substr($path, -1) === '/') {
                $path .= 'index.html';
            } elseif (preg_match('/\.(php|aspx|asp|shtml|jsp|cgi)$/i', $path)) {
                $path = preg_replace('/\.(php|aspx|asp|shtml|jsp|cgi)$/i', '.html', $path);
            } elseif (preg_match('/\.(html|htm)$/i', $path)) {
                // keep as-is
            } else {
                // extensionless → treat as directory index
                $path .= '/index.html';
            }
        } else {
            // asset: strip cache-buster query
            if (substr($path, -1) === '/') {
                $path .= 'index.html';
            }
        }

        // sanitize traversal + windows-unsafe chars
        $path = str_replace(['\\', '..'], ['/', ''], $path);
        $path = preg_replace('#/+#', '/', $path);
        $path = ltrim($path, '/');
        if ($path === '') {
            $path = 'index.html';
        }
        return $path;
    }

    /** Relative path from a page file to a target file (both under site/). */
    private function relPath(string $from, string $to): string
    {
        $fromDir = dirname($from);
        $fromParts = $fromDir === '.' ? [] : explode('/', $fromDir);
        $toParts   = explode('/', $to);
        while ($fromParts && $toParts && $fromParts[0] === $toParts[0]) {
            array_shift($fromParts);
            array_shift($toParts);
        }
        $up = str_repeat('../', count($fromParts));
        return $up . implode('/', $toParts);
    }

    /* ------------------------------------------------------------------ */
    /* HTTP                                                                */
    /* ------------------------------------------------------------------ */

    /** Max bytes to buffer per download (decompression-bomb guard). */
    private const MAX_DOWNLOAD_BYTES = 62914560; // 60 MB

    /**
     * Speed presets → [delay between requests (us), retry attempts, backoff base (s)].
     * Fast: minimum delay, no retries — quick rips on friendly sites.
     * Balanced: modest delay + retries — good default.
     * Polite: slow + many retries — safest on Cloudflare/CDN-protected hosts.
     */
    private const SPEEDS = [
        'fast'     => ['delay' => 50000,  'attempts' => 1, 'backoff' => 1],
        'balanced' => ['delay' => 350000, 'attempts' => 3, 'backoff' => 2],
        'polite'   => ['delay' => 1000000, 'attempts' => 5, 'backoff' => 3],
    ];

    /**
     * Fetch with a politeness delay + retry on network-level failures
     * (timeouts/resets). Non-network failures (404 etc.) are not retried.
     * Speed preset controls delay / attempts / backoff (see self::SPEEDS).
     */
    private function fetch(string $url): ?array
    {
        usleep($this->delayUs);

        $attempts = $this->retryAttempts;
        for ($i = 0; $i < $attempts; $i++) {
            if ($i > 0) {
                sleep($this->backoffBase * $i); // backoff: 2s, 4s (balanced)
            }
            $res = $this->fetchOnce($url);
            if ($res !== null) {
                return $res;
            }
            // Only transient network errors deserve a retry.
            if ($this->lastFetchStatus !== 0 || $this->lastFetchErr === '') {
                break;
            }
        }
        return null;
    }

    private int $lastFetchStatus = 0;
    private string $lastFetchErr = '';

    private function fetchOnce(string $url): ?array
    {
        $this->lastFetchStatus = 0;
        $this->lastFetchErr = '';

        // Fast path: this host already proved it blocks PHP's cURL — go straight
        // to the OS curl binary instead of burning a request on the challenge.
        if ($this->hostChallenged === true && $this->isCrawlHost($url)) {
            $sys = $this->fetchViaSystemCurl($url);
            $this->lastFetchStatus = $sys['status'] ?? 0;
            $this->lastFetchErr = $sys === null ? 'system curl failed' : '';
            return $sys;
        }

        $ch = curl_init($url);
        $buf = '';
        $limit = self::MAX_DOWNLOAD_BYTES;
        // WRITEFUNCTION lets us abort mid-stream when a body exceeds the cap
        // (guards against decompression bombs with CURLOPT_ENCODING).
        curl_setopt_array($ch, [
            CURLOPT_WRITEFUNCTION => function ($ch, $data) use (&$buf, $limit) {
                $buf .= $data;
                if (strlen($buf) > $limit) {
                    return 0; // abort transfer
                }
                return strlen($data);
            },
            CURLOPT_HEADERFUNCTION => function ($ch, $header) {
                if (stripos($header, 'Content-Type:') === 0) {
                    $this->lastContentType = trim(substr($header, 13));
                }
                return strlen($header);
            },
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 8,
            CURLOPT_CONNECTTIMEOUT => 12,
            CURLOPT_TIMEOUT        => 45,
            CURLOPT_USERAGENT      => self::USER_AGENT,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_ENCODING       => '', // accept gzip/deflate
            CURLOPT_HTTPHEADER     => [
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language: en-US,en;q=0.9',
            ],
        ]);
        $this->lastContentType = '';
        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        $this->lastFetchStatus = $status;
        $this->lastFetchErr = $err;

        if ($ok === false || $status === 0 || $status >= 400 || $buf === '') {
            // Cloudflare bot-fight ("Just a moment…") or a TLS failure: PHP's OpenSSL
            // TLS fingerprint is easily detected. Retry once via the OS curl binary
            // (Windows ships a Schannel-based curl.exe that passes these checks).
            if ($this->looksLikeBotChallenge($buf, $err, $status)) {
                if ($this->isCrawlHost($url)) {
                    $this->hostChallenged = true; // remember for the rest of the crawl
                }
                $sys = $this->fetchViaSystemCurl($url);
                $this->lastFetchStatus = $sys['status'] ?? 0;
                $this->lastFetchErr = $sys === null ? 'system curl failed' : '';
                if ($sys !== null) {
                    return $sys;
                }
            }
            return null;
        }
        return [
            'body'         => $buf,
            'status'       => $status,
            'content_type' => $this->lastContentType,
        ];
    }

    private string $lastContentType = '';

    /** Once a host proves it challenges PHP's cURL, skip straight to the OS curl. */
    private ?bool $hostChallenged = null;

    private int $delayUs = 350000;       // politeness delay between requests
    private int $retryAttempts = 3;      // attempts on transient network failures
    private int $backoffBase = 2;        // backoff seconds (multiplied by attempt #)

    private function isCrawlHost(string $url): bool
    {
        $p = parse_url($url);
        $host = strtolower($p['host'] ?? '');
        return $host !== '' && $host === ($this->state['host'] ?? '');
    }

    /** Did this failure look like a bot challenge / TLS fingerprint block? */
    /** Normalize the speed preset and apply its delay / attempts / backoff. */
    private function applySpeed(): void
    {
        $speed = strtolower((string) ($this->options['speed'] ?? 'balanced'));
        if (!isset(self::SPEEDS[$speed])) {
            $speed = 'balanced';
        }
        $this->options['speed'] = $speed;
        $this->delayUs       = self::SPEEDS[$speed]['delay'];
        $this->retryAttempts = self::SPEEDS[$speed]['attempts'];
        $this->backoffBase   = self::SPEEDS[$speed]['backoff'];
    }

    private function looksLikeBotChallenge(string $body, string $err, int $status): bool
    {
        if ($status === 403 && $body !== '') {
            if (stripos($body, 'Just a moment') !== false || stripos($body, 'challenge-platform') !== false) {
                return true;
            }
        }
        if ($status === 0) {
            $low = strtolower($err);
            return str_contains($low, 'ssl') || str_contains($low, 'tls') || str_contains($low, 'certificate');
        }
        return false;
    }

    /**
     * Retry a fetch through the OS curl binary (Schannel on Windows).
     * Returns null when curl is unavailable or the retry fails.
     */
    private function fetchViaSystemCurl(string $url): ?array
    {
        static $curlBin = null;
        if ($curlBin === null) {
            $probe = @shell_exec('curl --version 2>&1');
            $curlBin = (is_string($probe) && $probe !== '' && stripos($probe, 'curl') !== false) ? 'curl' : false;
        }
        if ($curlBin === false) {
            return null;
        }

        $tmp = @tempnam(sys_get_temp_dir(), 'ripper');
        if ($tmp === false) {
            return null;
        }

        $cmd = sprintf(
            '%s -sS -L --compressed --max-redirs 8 --connect-timeout 12 --max-time 45 '
            . '-A %s -H %s -H %s '
            . '-o %s -w "%%{http_code}|%%{content_type}" %s',
            $curlBin,
            escapeshellarg(self::BROWSER_UA),
            escapeshellarg('Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'),
            escapeshellarg('Accept-Language: en-US,en;q=0.9'),
            escapeshellarg($tmp),
            escapeshellarg($url)
        );

        $meta = @shell_exec($cmd);
        if (!is_string($meta)) {
            @unlink($tmp);
            return null;
        }
        $meta = trim($meta);
        $parts = explode('|', $meta, 2);
        $status = (int) ($parts[0] ?? 0);
        $ct = $parts[1] ?? '';
        if ($status < 200 || $status >= 400) {
            @unlink($tmp);
            return null;
        }
        $size = @filesize($tmp);
        if ($size === false || $size > self::MAX_DOWNLOAD_BYTES) {
            @unlink($tmp);
            return null;
        }
        $body = (string) @file_get_contents($tmp);
        @unlink($tmp);
        if ($body === '') {
            return null;
        }
        return [
            'body'         => $body,
            'status'       => $status,
            'content_type' => $ct,
        ];
    }

    private function isHtml(string $contentType, string $body): bool
    {
        $ct = strtolower($contentType);
        if (str_contains($ct, 'text/html') || str_contains($ct, 'application/xhtml')) {
            return true;
        }
        // sniff
        $sniff = ltrim(substr($body, 0, 1024));
        return str_starts_with($sniff, '<!doctype html') || str_starts_with($sniff, '<html') || str_starts_with($sniff, '<head');
    }

    private function loadDom(string $html): ?DOMDocument
    {
        $prev = libxml_use_internal_errors(true);
        $doc = new DOMDocument();
        $doc->preserveWhiteSpace = true;
        // XML PI trick keeps UTF-8 handling correct; @ silences the PHP 8.1+ deprecation.
        $ok = @$doc->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        return $ok ? $doc : null;
    }

    /* ------------------------------------------------------------------ */
    /* robots.txt                                                          */
    /* ------------------------------------------------------------------ */

    private function robotsAllowed(string $url): bool
    {
        $host = $this->state['host'] ?? '';
        $scheme = $this->state['scheme'] ?? 'https';
        if ($host === '') {
            return true;
        }

        if ($this->robotsTxt === null) {
            $this->robotsTxt = '';
            $res = $this->fetch($scheme . '://' . $host . '/robots.txt');
            if ($res !== null) {
                $this->robotsTxt = (string) $res['body'];
            }
        }
        if ($this->robotsTxt === '') {
            return true;
        }

        $p = parse_url($url);
        $path = $p['path'] ?? '/';
        $inUserAgentBlock = false;
        $disallowed = [];

        foreach (preg_split('/\r?\n/', $this->robotsTxt) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            if (preg_match('/^user-agent:\s*(.*)$/i', $line, $m)) {
                $agent = strtolower(trim($m[1]));
                $inUserAgentBlock = ($agent === '*' || str_contains($agent, 'siteripper'));
                continue;
            }
            if ($inUserAgentBlock && preg_match('/^disallow:\s*(.*)$/i', $line, $m)) {
                $rule = trim($m[1]);
                if ($rule !== '') {
                    $disallowed[] = $rule;
                }
            }
        }

        foreach ($disallowed as $rule) {
            if ($rule !== '/' && str_starts_with($path, $rule)) {
                return false;
            }
            if ($rule === '/' && $path !== '/') {
                return false;
            }
        }
        return true;
    }

    /* ------------------------------------------------------------------ */
    /* Filesystem                                                          */
    /* ------------------------------------------------------------------ */

    /** Normalize path separators and resolve . / .. segments deterministically. */
    private static function normalizePath(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        $prefix = '';
        if (preg_match('#^[A-Za-z]:/#', $path, $m)) {
            $prefix = $m[0];
            $path = substr($path, strlen($m[0]));
        }
        $segments = [];
        foreach (explode('/', $path) as $seg) {
            if ($seg === '' || $seg === '.') {
                continue;
            }
            if ($seg === '..') {
                if ($segments) {
                    array_pop($segments);
                }
                continue;
            }
            $segments[] = $seg;
        }
        return $prefix . implode('/', $segments);
    }

    private function mkdir(string $dir): void
    {
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
    }

    private function copyTree(string $src, string $dst): int
    {
        $count = 0;
        $this->mkdir($dst);
        $items = @scandir($src);
        if ($items === false) {
            return 0;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $s = $src . '/' . $item;
            $d = $dst . '/' . $item;
            if (is_dir($s)) {
                $count += $this->copyTree($s, $d);
            } elseif (is_file($s)) {
                if (@copy($s, $d)) {
                    $count++;
                }
            }
        }
        return $count;
    }

    private function dirSize(string $dir): int
    {
        $size = 0;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile()) {
                $size += $f->getSize();
            }
        }
        return $size;
    }

    private function addDirToZip(ZipArchive $zip, string $dir, string $prefix): void
    {
        $items = @scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $full = $dir . '/' . $item;
            $rel  = $prefix === '' ? $item : $prefix . '/' . $item;
            if (is_dir($full)) {
                $zip->addEmptyDir($rel);
                $this->addDirToZip($zip, $full, $rel);
            } elseif (is_file($full)) {
                $zip->addFile($full, $rel);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* State / report                                                      */
    /* ------------------------------------------------------------------ */

    private function statePath(): string
    {
        return RIPPER_JOBS_DIR . '/' . $this->jobId . '/state.json';
    }

    private function saveState(): void
    {
        $this->mkdir(dirname($this->statePath()));
        @file_put_contents($this->statePath(), json_encode($this->state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    public function loadState(): bool
    {
        $path = $this->statePath();
        if (!is_file($path)) {
            return false;
        }
        $data = json_decode((string) @file_get_contents($path), true);
        if (!is_array($data)) {
            return false;
        }
        $this->state = $data;
        // restore the job's options so resumed runs honour them
        if (!empty($data['options']) && is_array($data['options'])) {
            $this->options = array_merge($this->options, $data['options']);
            $this->options['max_pages'] = max(1, min(2000, (int) $this->options['max_pages']));
            $this->options['max_depth'] = max(1, min(25, (int) $this->options['max_depth']));
            $this->applySpeed(); // recompute delay/attempts from the restored speed
        }
        return true;
    }

    private function writeReport(): void
    {
        $lines = [];
        $lines[] = 'SiteRipper v' . self::VERSION . ' export report';
        $lines[] = '==========================================';
        $lines[] = 'Job        : ' . $this->jobId;
        $lines[] = 'Start URL  : ' . ($this->state['start_url'] ?? '');
        $lines[] = 'Mode       : ' . ($this->state['mode'] ?? 'url');
        $lines[] = 'Pages      : ' . ($this->state['pages'] ?? 0);
        $lines[] = 'Assets     : ' . ($this->state['assets'] ?? 0);
        $lines[] = 'Bytes      : ' . number_format($this->state['bytes'] ?? 0);
        $lines[] = 'Started    : ' . date('Y-m-d H:i:s', (int) ($this->state['started_at'] ?? time()));
        $lines[] = 'Finished   : ' . (($this->state['finished_at'] ?? 0) ? date('Y-m-d H:i:s', (int) $this->state['finished_at']) : '—');
        $lines[] = '';
        if (!empty($this->state['failed'])) {
            $lines[] = 'Failed (' . count($this->state['failed']) . '):';
            foreach (array_slice($this->state['failed'], 0, 50) as $f) {
                $lines[] = '  - ' . $f['url'] . '  [' . $f['error'] . ']';
            }
            if (count($this->state['failed']) > 50) {
                $lines[] = '  … and ' . (count($this->state['failed']) - 50) . ' more';
            }
        } else {
            $lines[] = 'No failures.';
        }

        $report = implode("\n", $lines);
        @file_put_contents(RIPPER_JOBS_DIR . '/' . $this->jobId . '/report.txt', $report);
    }

    /* ------------------------------------------------------------------ */
    /* Static job management                                               */
    /* ------------------------------------------------------------------ */

    public static function listJobs(): array
    {
        $jobs = [];
        if (!is_dir(RIPPER_JOBS_DIR)) {
            return $jobs;
        }
        foreach (glob(RIPPER_JOBS_DIR . '/*', GLOB_ONLYDIR) as $dir) {
            $id = basename($dir);
            $stateFile = $dir . '/state.json';
            if (!is_file($stateFile)) {
                continue;
            }
            $state = json_decode((string) @file_get_contents($stateFile), true);
            if (!is_array($state)) {
                continue;
            }
            $zip = is_file($dir . '/export.zip');
            $jobs[] = [
                'id'         => $id,
                'start_url'  => $state['start_url'] ?? '',
                'mode'       => $state['mode'] ?? 'url',
                'status'     => $state['status'] ?? 'unknown',
                'pages'      => $state['pages'] ?? 0,
                'assets'     => $state['assets'] ?? 0,
                'bytes'      => $state['bytes'] ?? 0,
                'message'    => $state['message'] ?? '',
                'has_zip'    => $zip,
                'has_site'   => is_dir($dir . '/site'),
                'started_at' => $state['started_at'] ?? 0,
                'finished_at'=> $state['finished_at'] ?? 0,
            ];
        }
        usort($jobs, fn ($a, $b) => $b['started_at'] <=> $a['started_at']);
        return $jobs;
    }

    public static function deleteJob(string $id): bool
    {
        $id = preg_replace('/[^A-Za-z0-9_\-]/', '', $id);
        $dir = RIPPER_JOBS_DIR . '/' . $id;
        if (!is_dir($dir)) {
            return false;
        }
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $f) {
            if ($f->isDir()) {
                @rmdir($f->getPathname());
            } else {
                @unlink($f->getPathname());
            }
        }
        @rmdir($dir);
        return true;
    }
}
