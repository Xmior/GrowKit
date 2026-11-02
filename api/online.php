<?php
// Same-origin relay for the player count: growtopiagame.com/detail only allows its own site in browsers.
// Returns just the count and caches it for a minute so visitors don't each hit the game's server.
header('Content-Type: application/json');

const SOURCE = 'https://www.growtopiagame.com/detail';
const CACHE_SECONDS = 60;
$cacheFile = sys_get_temp_dir() . '/growkit_online.json';

if (is_file($cacheFile) && time() - filemtime($cacheFile) < CACHE_SECONDS) {
    readfile($cacheFile);
    exit;
}

$context = stream_context_create(['http' => ['timeout' => 8, 'user_agent' => 'Mozilla/5.0 GrowKit']]);
$body = @file_get_contents(SOURCE, false, $context);
$data = $body === false ? null : json_decode($body, true);

if (!is_array($data) || !isset($data['online_user'])) {
    http_response_code(502);
    echo '{"error":"unavailable"}';
    exit;
}

$result = json_encode(['online_user' => (int) $data['online_user']]);
@file_put_contents($cacheFile, $result);
echo $result;
