<?php
/**
 * Coloring manifest builder (resumable and fast)
 * - Scans /static/<version>/<category>/pages/*.png
 * - Generates /thumbs/*@2x.webp if missing
 * - Writes /manifests/<version>.json after each category (safe resume)
 *
 * Run via CLI when possible:
 *   php -d max_execution_time=0 build_manifest.php version=v1 force=0
 *
 * Web usage (last resort):
 *   /coloring/build_manifest.php?version=v1&force=0
 */

header('Content-Type: text/plain; charset=utf-8');

// -------- Config --------
$version   = $_GET['version'] ?? ($argv[1] ?? 'v2');
$force     = (int)($_GET['force'] ?? ($argv[2] ?? 0));  // 1 = overwrite thumbs
$thumbEdge = 640; // long edge for @2x thumbs
$memLimit  = '512M';

// -------- Paths --------
$baseUrl   = (isset($_SERVER['HTTPS']) ? 'https://' : 'http://') .
             ($_SERVER['HTTP_HOST'] ?? 'localhost') . '/coloring/static/' . $version . '/';
$root      = __DIR__ . '/static/' . $version;
$manDir    = __DIR__ . '/manifests';
$manPath   = $manDir . '/' . $version . '.json';

// -------- Environment hardening --------
@ini_set('memory_limit', $memLimit);
// Allow long runs on CLI; for web, we’ll keep resetting below:
@ini_set('max_execution_time', '0');
ignore_user_abort(true);

// Detect engines
$HAS_IMAGICK = extension_loaded('imagick');
$HAS_GD      = function_exists('imagecreatefrompng');

if (!$HAS_IMAGICK && !$HAS_GD) {
  echo "WARNING: Neither Imagick nor GD extensions are available.\n";
  echo "Thumbnails will be skipped. Manifest will still be generated.\n\n";
}

// -------- Helpers --------
function safe_mkdir($dir) { if (!is_dir($dir)) @mkdir($dir, 0755, true); }

function make_webp_imagick($src, $dst, $edge) {
  $im = new Imagick();
  $im->readImage($src);
  $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_ACTIVATE);
  $im->setBackgroundColor(new ImagickPixel('transparent'));
  $im->setImageFormat('webp');
  // scale
  $w = $im->getImageWidth(); $h = $im->getImageHeight();
  $ratio = $edge / max($w, $h);
  $nw = max(1, (int)round($w * $ratio));
  $nh = max(1, (int)round($h * $ratio));
  $im->resizeImage($nw, $nh, Imagick::FILTER_LANCZOS, 1);
  $im->setImageCompressionQuality(80);
  $ok = $im->writeImage($dst);
  $im->clear(); $im->destroy();
  return $ok;
}

function make_webp_gd($src, $dst, $edge) {
  $im = @imagecreatefrompng($src);
  if (!$im) return false;
  imagesavealpha($im, true);
  $w = imagesx($im); $h = imagesy($im);
  $ratio = $edge / max($w, $h);
  $nw = max(1, (int)round($w * $ratio));
  $nh = max(1, (int)round($h * $ratio));
  $dstIm = imagecreatetruecolor($nw, $nh);
  imagesavealpha($dstIm, true);
  imagealphablending($dstIm, false);
  $transparent = imagecolorallocatealpha($dstIm, 0, 0, 0, 127);
  imagefill($dstIm, 0, 0, $transparent);
  imagecopyresampled($dstIm, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
  $ok = imagewebp($dstIm, $dst, 80);
  imagedestroy($dstIm); imagedestroy($im);
  return $ok;
}

function ensure_webp_thumb($srcPng, $destWebp, $edge, $force, $HAS_IMAGICK, $HAS_GD) {
  if (!$force && file_exists($destWebp)) return true; // skip if done
  // Reset timer so we don't hit 120s web cap
  @set_time_limit(30);

  if ($HAS_IMAGICK) {
    return make_webp_imagick($srcPng, $destWebp, $edge);
  } elseif ($HAS_GD) {
    return make_webp_gd($srcPng, $destWebp, $edge);
  } else {
    // No engine: pretend success but skip writing
    return true;
  }
}

// -------- Build --------
safe_mkdir($manDir);

if (!is_dir($root)) {
  echo "ERROR: static version folder not found: $root\n";
  exit(1);
}

$categories = [];
$catDirs = glob($root . '/*', GLOB_ONLYDIR);
sort($catDirs, SORT_NATURAL | SORT_FLAG_CASE);

$totalPages = 0;
$totalThumbs = 0;

foreach ($catDirs as $catDir) {
  $slug = basename($catDir);
  $pagesDir  = $catDir . '/pages';
  $thumbsDir = $catDir . '/thumbs';
  if (!is_dir($pagesDir)) continue;
  safe_mkdir($thumbsDir);

  $items = [];

// Collect both PNG and SVG files from /pages
$files = array_merge(
  glob($pagesDir . '/*.png'),
  glob($pagesDir . '/*.svg')
);

// Remove duplicates just in case
$files = array_unique($files);

// Natural sort so 1,2,10 instead of 1,10,2
sort($files, SORT_NATURAL | SORT_FLAG_CASE);

foreach ($files as $file) {
  $id  = pathinfo($file, PATHINFO_FILENAME);
  $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION)); // 'png' or 'svg'

  // If SVG: use original file as thumb
  if ($ext === 'svg') {
      $thumbUrl = $baseUrl . $slug . '/pages/' . $id . '.svg';
  } else {
      // PNG case stays the same
      $thumb = $thumbsDir . '/' . $id . '@2x.webp';
      $ok = ensure_webp_thumb($file, $thumb, $thumbEdge, $force, $HAS_IMAGICK, $HAS_GD);
      if (!$ok) { 
        echo "WARN: Failed thumb: $thumb (from $file)\n"; 
      }
      $thumbUrl = $baseUrl . $slug . '/thumbs/' . $id . '@2x.webp';
  }

  // Get size (for PNG will work; for SVG may return false, then defaults)
  $sz = @getimagesize($file);
  $w = $sz ? $sz[0] : 1600;
  $h = $sz ? $sz[1] : 1200;

  $items[] = [
    'id'    => $id,
    'label' => ucwords(str_replace(['-', '_'], ' ', $id)),
    // Use the actual extension here (.png OR .svg)
    'src'   => $baseUrl . $slug . '/pages/'  . $id . '.' . $ext,
    'thumb' => $thumbUrl,
    'w'     => $w,
    'h'     => $h
  ];

  $totalPages++;
  $totalThumbs++;
}


  $categories[] = [
    'id'    => $slug,
    'title' => ucwords(str_replace(['-', '_'], ' ', $slug)),
    'items' => $items
  ];

  // Write manifest after each category for safe resume
  $manifest = [
    'version'    => $version,
    'updated_at' => gmdate('c'),
    'categories' => $categories
  ];
  @file_put_contents($manPath, json_encode($manifest, JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT));
  echo ">> Wrote partial manifest after category: $slug\n";
  @flush(); @ob_flush();
}

echo "\nDONE.\nImages: $totalPages | Thumbs processed (new or skipped): $totalThumbs\n";
echo "Manifest: $manPath\n";
