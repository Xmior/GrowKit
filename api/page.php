<?php
// Same-origin relay for public Growtopia pages that browsers can't read from another site.
// Only the listed pages can be requested, and each is cached for a minute.
const PAGES = ['auction' => 'https://www.growtopiagame.com/auction', 'leaderboard' => 'https://www.growtopiagame.com/leaderboard'];
const CACHE_SECONDS = 60;

$page = $_GET['page'] ?? '';
if (!isset(PAGES[$page])) {
    http_response_code(404);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
$cacheFile = sys_get_temp_dir() . "/growkit_$page.html";
if (is_file($cacheFile) && time() - filemtime($cacheFile) < CACHE_SECONDS) {
    readfile($cacheFile);
    exit;
}

$context = stream_context_create(['http' => ['timeout' => 12, 'user_agent' => 'Mozilla/5.0 GrowKit']]);
$body = @file_get_contents(PAGES[$page], false, $context);
if ($body === false) {
    http_response_code(502);
    exit;
}

@file_put_contents($cacheFile, $body);
echo $body;
