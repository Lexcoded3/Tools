<?php
/**
 * SiteRipper — CLI export.
 *
 * Usage:
 *   php cli.php https://demo.pro.radio/wp38
 *   php cli.php "C:/xampp/htdocs/2026/AttanNew/Tools/html_backup"
 *   php cli.php https://example.com --max-pages=50 --depth=4 --external --no-media --no-robots --out=myproject
 *   php cli.php https://example.com --speed=polite
 *
 * Options:
 *   --max-pages=N    page crawl limit (default 100)
 *   --depth=N        max link depth (default 5)
 *   --external       also mirror external-host assets
 *   --no-media       skip <img>/<video> media (CSS backgrounds/fonts always kept)
 *   --no-robots      ignore robots.txt
 *   --speed=MODE     fast | balanced | polite (default balanced)
 *   --out=NAME       job id / output folder name (default rip-<timestamp>)
 */

declare(strict_types=1);
set_time_limit(0);
error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING);

require __DIR__ . '/lib/Ripper.php';

$args = $argv;
array_shift($args);

$target = null;
$opts = [
    'max_pages'       => 100,
    'max_depth'       => 5,
    'external_assets' => false,
    'download_media'  => true,
    'respect_robots'  => true,
    'speed'           => 'balanced',
];
$out = null;

foreach ($args as $arg) {
    if (preg_match('/^--max-pages=(\d+)$/', $arg, $m)) {
        $opts['max_pages'] = max(1, min(2000, (int) $m[1]));
    } elseif (preg_match('/^--depth=(\d+)$/', $arg, $m)) {
        $opts['max_depth'] = max(1, min(25, (int) $m[1]));
    } elseif ($arg === '--external') {
        $opts['external_assets'] = true;
    } elseif ($arg === '--no-media') {
        $opts['download_media'] = false;
    } elseif ($arg === '--no-robots') {
        $opts['respect_robots'] = false;
    } elseif (preg_match('/^--speed=(fast|balanced|polite)$/i', $arg, $m)) {
        $opts['speed'] = strtolower($m[1]);
    } elseif (preg_match('/^--out=(.+)$/', $arg, $m)) {
        $out = $m[1];
    } elseif ($target === null) {
        $target = $arg;
    }
}

if ($target === null) {
    fwrite(STDERR, "Usage: php cli.php <url-or-folder> [--max-pages=N] [--depth=N] [--external] [--no-media] [--no-robots] [--out=NAME]\n");
    exit(1);
}

try {
    $id = $out ?: ('rip-' . date('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 6));
    $ripper = new SiteRipper($id, $opts);
    $state = $ripper->start($target);

    echo "SiteRipper v" . SiteRipper::VERSION . "\n";
    echo "Job: {$id}\nTarget: {$target}\n\n";

    if (($state['status'] ?? '') === 'done') {
        echo $state['message'] . "\n";
    } else {
        while (($state['status'] ?? '') === 'running') {
            $state = $ripper->runBatch(8);
            $q = count($state['queue'] ?? []);
            printf("\r  pages: %-5d assets: %-5d size: %-9s queued: %-4d failed: %d  ",
                $state['pages'] ?? 0,
                $state['assets'] ?? 0,
                fmt($state['bytes'] ?? 0),
                $q,
                count($state['failed'] ?? [])
            );
        }
        echo "\n\n" . ($state['message'] ?? 'Done.') . "\n";
    }

    $dir = $ripper->getSiteDir();
    echo "\nExported to: " . str_replace('/', DIRECTORY_SEPARATOR, $dir) . "\n";

    $zip = $ripper->createZip();
    if ($zip !== null && is_file($zip)) {            echo "ZIP:         " . str_replace('/', DIRECTORY_SEPARATOR, $zip) . " (" . fmt((int) filesize($zip)) . ")\n";
    } else {
        echo "ZIP:         (php zip extension unavailable — folder is already on disk)\n";
    }

    if (!empty($state['failed'])) {
        echo "\nFailed items: " . count($state['failed']) . " (see " . str_replace('/', DIRECTORY_SEPARATOR, RIPPER_JOBS_DIR . '/' . $id . '/report.txt') . ")\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, "\nError: " . $e->getMessage() . "\n");
    exit(1);
}

function fmt(int $b): string
{
    return $b >= 1048576 ? round($b / 1048576, 1) . ' MB' : ($b >= 1024 ? round($b / 1024) . ' KB' : $b . ' B');
}
