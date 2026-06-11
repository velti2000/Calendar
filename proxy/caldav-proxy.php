<?php
/**
 * caldav-proxy.php  –  Vermittler zwischen der Calendar-PWA und mailbox.org
 * ===========================================================================
 * Warum es diesen Proxy gibt:
 *   Ein Browser darf aus Sicherheitsgruenden (CORS) nicht direkt mit dem
 *   CalDAV-Server von mailbox.org sprechen. PHP auf deinem Webserver hat dieses
 *   Problem nicht und leitet die Anfragen einfach weiter.
 *
 * Diese Datei kommt auf DEINEN Webserver (mit PHP). Die App schickt jede
 * CalDAV-Anfrage als POST hierher; im Header steht, was wirklich gemeint ist:
 *   X-Dav-Method   z.B. PROPFIND, REPORT, GET, PUT, DELETE
 *   X-Dav-Target   die Ziel-URL auf dem CalDAV-Server
 *   X-Dav-User     mailbox.org-Benutzername (E-Mail)
 *   X-Dav-Pass     (App-)Passwort
 *   X-Dav-Depth    optionaler WebDAV-Depth-Header
 *   X-Dav-If-Match optionaler ETag (fuer sicheres Aendern/Loeschen)
 *
 * SICHERHEIT:
 *   - Es werden NUR Anfragen an erlaubte Hosts (dav.mailbox.org) weitergeleitet.
 *   - Die Zugangsdaten werden NICHT gespeichert, nur durchgereicht.
 *   - Lege diese Datei moeglichst hinter HTTPS ab.
 */

// --- Erlaubte Ziel-Hosts (Allowlist) ---------------------------------------
$ALLOWED_HOSTS = ['dav.mailbox.org'];

// --- CORS: dem Browser erlauben, diesen Proxy aufzurufen --------------------
// Tipp: Fuer mehr Sicherheit kannst du '*' durch deine konkrete App-URL ersetzen.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Dav-Method, X-Dav-Target, X-Dav-User, X-Dav-Pass, X-Dav-Depth, X-Dav-If-Match');
header('Access-Control-Expose-Headers: X-Dav-Etag, X-Dav-Status');

// Preflight-Anfrage des Browsers sofort beantworten.
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Eingehende Header einlesen --------------------------------------------
function header_value($name, $default = '') {
    // Header kommen in PHP als HTTP_X_DAV_METHOD usw. an.
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? $_SERVER[$key] : $default;
}

$method  = strtoupper(header_value('X-Dav-Method', 'GET'));
$target  = header_value('X-Dav-Target', '');
$user    = header_value('X-Dav-User', '');
$pass    = header_value('X-Dav-Pass', '');
$depth   = header_value('X-Dav-Depth', '');
$ifMatch = header_value('X-Dav-If-Match', '');
$body    = file_get_contents('php://input');

// --- Eingaben pruefen -------------------------------------------------------
if ($target === '') {
    http_response_code(400);
    echo 'Fehlende Ziel-URL (X-Dav-Target).';
    exit;
}

$parsed = parse_url($target);
if ($parsed === false || !isset($parsed['host']) || !in_array($parsed['host'], $ALLOWED_HOSTS, true)) {
    http_response_code(403);
    echo 'Ziel-Host nicht erlaubt.';
    exit;
}

// Nur bekannte WebDAV-Methoden zulassen.
$allowedMethods = ['GET', 'PUT', 'DELETE', 'PROPFIND', 'REPORT', 'MKCALENDAR', 'OPTIONS', 'HEAD'];
if (!in_array($method, $allowedMethods, true)) {
    http_response_code(405);
    echo 'Methode nicht erlaubt.';
    exit;
}

// --- Anfrage per cURL an den CalDAV-Server weiterleiten ---------------------
$ch = curl_init($target);

$forwardHeaders = [];
$contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
if ($contentType !== '') $forwardHeaders[] = 'Content-Type: ' . $contentType;
if ($depth !== '')       $forwardHeaders[] = 'Depth: ' . $depth;
if ($ifMatch !== '')     $forwardHeaders[] = 'If-Match: ' . $ifMatch;

curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $method,        // echte WebDAV-Methode
    CURLOPT_HTTPHEADER     => $forwardHeaders,
    CURLOPT_USERPWD        => $user . ':' . $pass,  // Basic-Auth fuer mailbox.org
    CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,           // Antwort-Header mit auslesen
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => true,           // Zertifikat pruefen (Sicherheit)
]);

// Body nur bei schreibenden/abfragenden Methoden mitsenden.
if (in_array($method, ['PUT', 'REPORT', 'PROPFIND', 'MKCALENDAR'], true) && $body !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);

if ($response === false) {
    http_response_code(502);
    echo 'Proxy-Fehler: ' . curl_error($ch);
    curl_close($ch);
    exit;
}

$statusCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize  = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$rawHeaders  = substr($response, 0, $headerSize);
$rawBody     = substr($response, $headerSize);
curl_close($ch);

// --- Den ETag aus der Antwort herausziehen und weitergeben ------------------
// (Damit die App spaeter sicher aktualisieren/loeschen kann.)
if (preg_match('/^ETag:\s*(.+)$/mi', $rawHeaders, $m)) {
    header('X-Dav-Etag: ' . trim($m[1]));
}
header('X-Dav-Status: ' . $statusCode);

// Den urspruenglichen Status und Body an die App zurueckgeben.
http_response_code($statusCode);
header('Content-Type: ' . (preg_match('/^Content-Type:\s*(.+)$/mi', $rawHeaders, $ct) ? trim($ct[1]) : 'text/plain'));
echo $rawBody;
