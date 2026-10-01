<?php
/* ============================================================
   MOCKUPGEN — mockup.php
   Upload mode: takes a screenshot (png/jpg/webp) + device id,
   composites it into a device frame drawn with PHP GD,
   saves the result, and returns JSON { file, device, w, h }.
   ============================================================ */

if (!extension_loaded('gd')) {
    header('Content-Type: application/json');
    http_response_code(500);
    exit(json_encode(['ok' => false, 'error' => 'GD extension not available']));
}

define('OUT_DIR', __DIR__ . '/data');
if (!is_dir(OUT_DIR)) { @mkdir(OUT_DIR, 0775, true); }

/* ---------- helpers ---------- */

function roundedRect($img, $x1, $y1, $x2, $y2, $r, $color) {
    $r = max(0, min($r, (int)(($x2 - $x1) / 2), (int)(($y2 - $y1) / 2)));
    imagefilledellipse($img, $x1 + $r, $y1 + $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x2 - $r, $y1 + $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x1 + $r, $y2 - $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x2 - $r, $y2 - $r, $r * 2, $r * 2, $color);
    imagefilledrectangle($img, $x1, $y1 + $r, $x2, $y2 - $r, $color);
    imagefilledrectangle($img, $x1 + $r, $y1, $x2 - $r, $y2, $color);
}

function vGradient($img, $x1, $y1, $x2, $y2, $cTop, $cBot) {
    $h = $y2 - $y1;
    for ($y = 0; $y <= $h; $y++) {
        $t = $h > 0 ? $y / $h : 0;
        $col = imagecolorallocate($img,
            (int)($cTop[0] + ($cBot[0] - $cTop[0]) * $t),
            (int)($cTop[1] + ($cBot[1] - $cTop[1]) * $t),
            (int)($cTop[2] + ($cBot[2] - $cTop[2]) * $t));
        imagefilledrectangle($img, $x1, $y1 + $y, $x2, $y1 + $y, $col);
    }
}

/** Cover-crop $src into exactly $w x $h (center crop), with rounded
    corners: the corner arcs are filled with $well_rgb (the device's
    screen-well color) so they blend into the bezel behind the shot. */
function coverCrop($src, $w, $h, $radius, array $well_rgb) {
    $sw = imagesx($src);
    $sh = imagesy($src);
    $scale = max($w / $sw, $h / $sh);
    $nw = (int)round($sw * $scale);
    $nh = (int)round($sh * $scale);
    $tmp = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($tmp, $src, 0, 0, 0, 0, $nw, $nh, $sw, $sh);
    $dst = imagecreatetruecolor($w, $h);
    $ox = (int)(($nw - $w) / 2);
    $oy = (int)(($nh - $h) / 2);
    imagecopy($dst, $tmp, 0, 0, $ox, $oy, $w, $h);

    $r = max(1, min($radius, (int)($w / 2), (int)($h / 2)));
    $col = imagecolorallocate($dst, $well_rgb[0], $well_rgb[1], $well_rgb[2]);
    $corners = [[0, 0], [$w - $r - 1, 0], [0, $h - $r - 1], [$w - $r - 1, $h - $r - 1]];
    foreach ($corners as [$cx, $cy]) {
        for ($dx = 0; $dx <= $r; $dx++) {
            for ($dy = 0; $dy <= $r; $dy++) {
                $px = $cx + $dx;
                $py = $cy + $dy;
                $inside = (($dx - $r) * ($dx - $r) + ($dy - $r) * ($dy - $r)) <= $r * $r;
                $c = $inside ? imagecolorat($tmp, $ox + $px, $oy + $py) : $col;
                imagesetpixel($dst, $px, $py, $c);
            }
        }
    }
    imagedestroy($tmp);
    return $dst;
}

/* ---------- device frame config ----------
   Each device: canvas size + screen rect where the screenshot is pasted.
   Screens are drawn at 2x so the final image is crisp. */
$devices = [
    'desktop'   => ['w' => 1920, 'h' => 1200, 'screen' => [80, 60, 1840, 1060]],
    'macbook'   => ['w' => 1600, 'h' => 1000, 'screen' => [120, 60, 1480, 840]],
    'ipad'      => ['w' => 900,  'h' => 1200, 'screen' => [80, 110, 820, 1060]],
    'iphone-x'  => ['w' => 540,  'h' => 1100, 'screen' => [20, 40, 520, 1060]],
    'iphone-se' => ['w' => 460,  'h' => 980,  'screen' => [40, 80, 420, 800]],
];

$device = isset($_POST['device']) ? (string) $_POST['device'] : '';
if (!isset($devices[$device])) {
    header('Content-Type: application/json');
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'Unknown device: ' . $device]));
}

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    header('Content-Type: application/json');
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'No file uploaded']));
}

$tmp = $_FILES['file']['tmp_name'];
$info = @getimagesize($tmp);
if ($info === false) {
    header('Content-Type: application/json');
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'Unreadable image']));
}
$mime = $info['mime'];
if (!in_array($mime, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true)) {
    header('Content-Type: application/json');
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'Only PNG / JPG / WEBP allowed']));
}
if (filesize($tmp) > 15 * 1024 * 1024) {
    header('Content-Type: application/json');
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'File too large (>15MB)']));
}

$src = @imagecreatefromstring((string) file_get_contents($tmp));
if ($src === false) {
    header('Content-Type: application/json');
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'Could not decode image']));
}

/* ---------- composite ---------- */
$cfg = $devices[$device];
[$sx, $sy, $sx2, $sy2] = $cfg['screen'];
$sw = $sx2 - $sx;
$sh = $sy2 - $sy;

$img = imagecreatetruecolor($cfg['w'], $cfg['h']);
imagealphablending($img, true);
imagesavealpha($img, true);
$transparent = imagecolorallocatealpha($img, 0, 0, 0, 127);
imagefill($img, 0, 0, $transparent);

// 1) device frame first (bezel + screen well), so the paste sits on top
$C = fn($hex) => imagecolorallocate($img,
    hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2)));

switch ($device) {
    case 'desktop':
        // bezel
        roundedRect($img, 40, 40, 1880, 1100, 24, $C('1a1a1c'));
        // screen well
        roundedRect($img, 76, 56, 1844, 1064, 12, $C('050505'));
        // camera dot
        imagefilledellipse($img, 960, 48, 10, 10, $C('000000'));
        // monitor stand (neck)
        imagefilledrectangle($img, 900, 1100, 1020, 1140, $C('2b2e33'));
        imagefilledrectangle($img, 915, 1100, 1005, 1140, $C('18181c'));
        // monitor base (wide slab)
        vGradient($img, 700, 1132, 1220, 1190, [58, 61, 67], [23, 25, 29]);
        roundedRect($img, 700, 1132, 1220, 1190, 12, $C('1f2126'));
        // base top highlight
        imagefilledrectangle($img, 700, 1132, 1220, 1134, $C('4a4e55'));
        break;

    case 'macbook':
        // bezel
        roundedRect($img, 40, 40, 1560, 900, 40, $C('1a1a1c'));
        // screen well
        roundedRect($img, 116, 56, 1484, 844, 12, $C('050505'));
        // camera dot
        imagefilledellipse($img, 800, 48, 10, 10, $C('000000'));
        // base
        vGradient($img, 100, 900, 1500, 996, [44, 44, 48], [16, 16, 20]);
        roundedRect($img, 60, 900, 1540, 996, 28, $C('18181c'));
        // base notch (rounded dip at bottom center)
        imagefilledellipse($img, 800, 1000, 220, 60, $C('0b0b0d'));
        // base top highlight
        imagefilledrectangle($img, 100, 900, 1500, 902, $C('3a3a40'));
        break;

    case 'ipad':
        // body
        roundedRect($img, 20, 20, 880, 1180, 60, $C('1e1e22'));
        // screen well
        roundedRect($img, 76, 106, 824, 1064, 22, $C('050505'));
        // camera
        imagefilledellipse($img, 450, 46, 12, 12, $C('0a0a0c'));
        // home button
        imagefilledellipse($img, 450, 1130, 48, 48, $C('2a2a2e'));
        imagefilledellipse($img, 450, 1130, 34, 34, $C('141416'));
        break;

    case 'iphone-x':
        // body
        roundedRect($img, 10, 10, 530, 1090, 70, $C('0d0d10'));
        // screen well
        roundedRect($img, 16, 36, 524, 1064, 30, $C('000000'));
        // side buttons
        imagefilledrectangle($img, 2, 220, 10, 280, $C('2c2c30'));
        imagefilledrectangle($img, 2, 320, 10, 380, $C('2c2c30'));
        imagefilledrectangle($img, 530, 300, 538, 400, $C('2c2c30'));
        break;

    case 'iphone-se':
        // body
        roundedRect($img, 10, 10, 450, 970, 55, $C('151519'));
        // screen well
        roundedRect($img, 36, 76, 424, 804, 12, $C('050505'));
        // speaker
        roundedRect($img, 190, 26, 270, 42, 8, $C('0a0a0c'));
        // home button
        imagefilledellipse($img, 230, 890, 52, 52, $C('2a2a2e'));
        imagefilledellipse($img, 230, 890, 38, 38, $C('141416'));
        break;
}

// 2) screenshot into the screen rect — pasted AFTER the frame so it shows
$well_radius = ['desktop' => 12, 'macbook' => 12, 'ipad' => 22, 'iphone-x' => 30, 'iphone-se' => 12][$device] ?? 12;
$well_rgb    = ['desktop' => [5, 5, 5], 'macbook' => [5, 5, 5], 'ipad' => [5, 5, 5], 'iphone-x' => [0, 0, 0], 'iphone-se' => [5, 5, 5]][$device] ?? [5, 5, 5];
$shot = coverCrop($src, $sw, $sh, $well_radius, $well_rgb);
imagecopy($img, $shot, $sx, $sy, 0, 0, $sw, $sh);
imagedestroy($shot);
imagedestroy($src);

// 3) details that sit ON TOP of the screen
if ($device === 'iphone-x') {
    // notch (dynamic island) over the screen
    roundedRect($img, 200, 28, 340, 66, 18, $C('000000'));
}

/* ---------- save + respond ---------- */
$name = 'mock-' . $device . '-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.png';
$path = OUT_DIR . '/' . $name;
imagepng($img, $path);
imagedestroy($img);

// clean up files older than 2 hours
foreach (glob(OUT_DIR . '/mock-*.png') ?: [] as $old) {
    if (filemtime($old) < time() - 7200) { @unlink($old); }
}

header('Content-Type: application/json');
echo json_encode([
    'ok'     => true,
    'file'   => 'data/' . $name,
    'device' => $device,
    'w'      => $cfg['w'],
    'h'      => $cfg['h'],
]);
