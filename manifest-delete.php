<?php
// /public_html/coloring/manifest.php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
$base = 'https://coloring.readernook.com/static/v1/';
$root = __DIR__ . '/static/v1';

function list_items($dir, $baseUrl) {
  $items = [];
  foreach (glob("$dir/pages/*.png") as $p) {
    $id = pathinfo($p, PATHINFO_FILENAME);
    $thumb = preg_replace('#/pages/#','/thumbs/',$p);
    $thumb = preg_replace('#\.png$#','@2x.webp',$thumb);
    $items[] = [
      'id' => $id,
      'label' => ucwords(str_replace('-', ' ', $id)),
      'src' => $baseUrl.'pages/'.$id.'.png',
      'thumb' => $baseUrl.'thumbs/'.$id.'@2x.webp'
    ];
  }
  return $items;
}

$categories = [];
foreach (glob("$root/*", GLOB_ONLYDIR) as $catDir) {
  $slug = basename($catDir);
  $categories[] = [
    'id' => $slug,
    'title' => ucwords(str_replace('-', ' ', $slug)),
    'items' => list_items($catDir, $base.$slug.'/')
  ];
}

echo json_encode(['version'=>'v1','updated_at'=>gmdate('c'),'categories'=>$categories]);
