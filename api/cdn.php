<?php
// Same-origin relay for Growtopia's CDN, which sends no CORS headers, so the Files Archive can preview files.
// Only files under 0098/<cache ID>/cache/ or /cachebeta/ can be requested, up to 40 MB.
const CDN = 'https://ubistatic-a.akamaihd.net/';
const MAX_BYTES = 40 * 1024 * 1024;

$path = $_GET['path'] ?? '';
if (!preg_match('#^0098/[A-Za-z0-9_-]{1,40}/cache(beta)?/[A-Za-z0-9_./ -]{1,200}$#', $path) || strpos($path, '..') !== false) {
    http_response_code(400);
    exit;
}

$url = CDN . implode('/', array_map('rawurlencode', explode('/', $path)));
$context = stream_context_create(['http' => ['timeout' => 20, 'user_agent' => 'GrowKit-CDNMapping', 'ignore_errors' => true]]);
$body = @file_get_contents($url, false, $context, 0, MAX_BYTES + 1);
$status = 502;
foreach ($http_response_header ?? [] as $line) {
    if (preg_match('#^HTTP/\S+ (\d+)#', $line, $m)) $status = (int) $m[1];
}
if ($body === false || $status !== 200 || strlen($body) > MAX_BYTES) {
    http_response_code($status === 200 ? 502 : $status);
    exit;
}
header('Content-Type: application/octet-stream');
header('Cache-Control: public, max-age=86400');
header('Content-Length: ' . strlen($body));
echo $body;
