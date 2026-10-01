<?php
/**
 * WHOIS — domain / IP / ASN lookup terminal (backend).
 *
 * Keyless, free lookups only:
 *   1. RDAP (Registration Data Access Protocol) over HTTPS — the modern,
 *      JSON replacement for whois. rdap.org redirects to the right registry
 *      (Verisign, RIPE, ARIN, …) automatically.
 *   2. Classic whois over TCP port 43 as a fallback for domains that expose
 *      richer raw records (registrar, nameservers, DNSSEC, dates).
 *
 * Endpoints (GET api.php):
 *   action=lookup&q=example.com     domain lookup (RDAP first, port 43 fallback)
 *   action=lookup&q=8.8.8.8         IP lookup via RDAP (/ip/)
 *   action=lookup&q=AS15169         ASN lookup via RDAP (/autnum/)
 *
 * Pure PHP, zero dependencies. Requires php-curl (or openssl + sockets for the
 * port-43 fallback) and outbound HTTPS — ships enabled in stock XAMPP.
 */
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('default_socket_timeout', '25');
set_time_limit(60);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function api_out(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function api_error(string $message, int $code = 400): void
{
    api_out(['ok' => false, 'error' => $message], $code);
}

/** HTTPS GET returning raw body ('' on failure). */
function https_get(string $url, int $timeout = 20): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 5,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT      => UA,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return is_string($body) && $code < 400 ? $body : '';
    }
    $ctx = stream_context_create(['http' => [
        'timeout'       => $timeout,
        'user_agent'    => UA,
        'header'        => "Accept: application/json\r\n",
        'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    return is_string($body) ? $body : '';
}

/** Is this a valid domain-ish query (hostname / IP / ASN / IPv6)? */
function classify_query(string $q): array
{
    $q = trim($q);
    $asn = null;
    if (preg_match('/^(?:AS|as|autnum)?\s*(\d{1,10})$/i', $q, $m)) {
        // Pure number = ASN only if it parses as one; otherwise it's an IP-ish
        // single number which we route to whois port 43 / RDAP ip anyway.
        $asn = (int) $m[1];
    }
    $ipv4 = filter_var($q, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
    $ipv6 = filter_var($q, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
    if ($ipv4 !== false) return ['kind' => 'ip', 'value' => $ipv4];
    if ($ipv6 !== false) return ['kind' => 'ip', 'value' => $ipv6];
    if (preg_match('/^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)+$/i', $q)) {
        return ['kind' => 'domain', 'value' => strtolower($q)];
    }
    if ($asn !== null && $asn >= 1 && $asn <= 4294967295) {
        return ['kind' => 'asn', 'value' => (string) $asn];
    }
    return ['kind' => 'unknown', 'value' => $q];
}

/**
 * RDAP lookup. rdap.org is the bootstrap hub but occasionally refuses to route
 * an autnum/IP to the owning registry, so fall back to direct registry RDAP
 * servers (ARIN / RIPE) that answer without a prefix.
 */
function rdap_lookup(string $kind, string $value): array
{
    $asnNum = (int) $value;
    $candidates = [];
    if ($kind === 'domain') {
        $candidates[] = ['base' => 'https://rdap.org', 'path' => 'domain/' . rawurlencode($value)];
    } elseif ($kind === 'asn') {
        $candidates[] = ['base' => 'https://rdap.org',       'path' => 'autnum/AS' . $asnNum];
        $candidates[] = ['base' => 'https://rdap.arin.net/registry', 'path' => 'autnum/' . $asnNum];
        $candidates[] = ['base' => 'https://rdap.db.ripe.net',       'path' => 'autnum/' . $asnNum];
    } else { // ip
        $candidates[] = ['base' => 'https://rdap.org', 'path' => 'ip/' . rawurlencode($value)];
        $candidates[] = ['base' => 'https://rdap.arin.net/registry', 'path' => 'ip/' . rawurlencode($value)];
        $candidates[] = ['base' => 'https://rdap.db.ripe.net',       'path' => 'ip/' . rawurlencode($value)];
    }

    $lastErr = '';
    foreach ($candidates as $c) {
        $raw = https_get($c['base'] . '/' . $c['path']);
        if ($raw === '') {
            $lastErr = 'RDAP unreachable (' . $c['base'] . ').';
            continue;
        }
        $j = json_decode($raw, true);
        if (!is_array($j)) {
            $lastErr = 'RDAP returned invalid JSON (' . $c['base'] . ').';
            continue;
        }
        if (!empty($j['errorCode']) || !empty($j['title'])) {
            $lastErr = (string) ($j['title'] ?? ('RDAP error ' . ($j['errorCode'] ?? 'unknown'))) . ' (' . $c['base'] . ')';
            continue;
        }
        return ['ok' => true, 'data' => $j, 'kind' => $kind, 'value' => $value, 'server' => $c['base']];
    }
    return ['ok' => false, 'error' => $lastErr !== '' ? $lastErr : 'RDAP lookup failed.'];
}

/** Flatten an RDAP JSON object into readable terminal lines. */
function rdap_to_lines(array $j, string $kind): array
{
    $L = [];
    if ($kind === 'domain') {
        $L[] = ['k' => 'DOMAIN',    'v' => (string) ($j['ldhName'] ?? $j['handle'] ?? '')];
        $L[] = ['k' => 'HANDLE',    'v' => (string) ($j['handle'] ?? '')];
        if (!empty($j['status'])) $L[] = ['k' => 'STATUS', 'v' => implode(', ', array_map('strtoupper', (array) $j['status']))];
        if (!empty($j['events'])) {
            foreach ($j['events'] as $ev) {
                if (empty($ev['eventAction'])) continue;
                $L[] = ['k' => strtoupper((string) $ev['eventAction']), 'v' => (string) ($ev['eventDate'] ?? '')];
            }
        }
        if (!empty($j['nameservers'])) {
            $ns = array_map(static fn ($n) => (string) ($n['ldhName'] ?? $n['name'] ?? ''), (array) $j['nameservers']);
            $L[] = ['k' => 'NAMESERVERS', 'v' => implode(', ', array_filter($ns))];
        }
        if (!empty($j['secureDNS'])) {
            $d = $j['secureDNS'];
            $L[] = ['k' => 'DNSSEC', 'v' => !empty($d['delegationSigned']) ? 'SIGNED' : 'unsigned'];
        }
    } elseif ($kind === 'asn') {
        $handle = (string) ($j['handle'] ?? '');
        $L[] = ['k' => 'ASN',       'v' => str_starts_with($handle, 'AS') ? $handle : 'AS' . $handle];
        $L[] = ['k' => 'NAME',      'v' => (string) ($j['name'] ?? '')];
        $L[] = ['k' => 'TYPE',      'v' => (string) ($j['type'] ?? '')];
        if (!empty($j['status'])) $L[] = ['k' => 'STATUS', 'v' => implode(', ', array_map('strtoupper', (array) $j['status']))];
        $L[] = ['k' => 'COUNTRY',   'v' => (string) ($j['country'] ?? '')];
    } else { // ip
        $L[] = ['k' => 'NETWORK',   'v' => (string) ($j['handle'] ?? '')];
        if (!empty($j['ipVersion'])) $L[] = ['k' => 'VERSION', 'v' => (string) $j['ipVersion']];
        if (!empty($j['startAddress']) || !empty($j['endAddress'])) {
            $L[] = ['k' => 'RANGE', 'v' => ($j['startAddress'] ?? '?') . ' – ' . ($j['endAddress'] ?? '?')];
        }
        if (!empty($j['name']))    $L[] = ['k' => 'NAME', 'v' => (string) $j['name']];
        if (!empty($j['country'])) $L[] = ['k' => 'COUNTRY', 'v' => (string) $j['country']];
        if (!empty($j['parentHandle'])) $L[] = ['k' => 'PARENT', 'v' => (string) $j['parentHandle']];
    }
    // Registrar / entities (shared)
    if (!empty($j['entities'])) {
        $roles = [];
        foreach ((array) $j['entities'] as $ent) {
            $role = (string) ($ent['roles'][0] ?? 'registrar');
            $name = '';
            // vcardArray: ["vcard", [["fn", {},"text","Google LLC"], …]] — find fn/org.
            $props = $ent['vcardArray'][1] ?? [];
            foreach ((array) $props as $p) {
                $pname = strtolower((string) ($p[0] ?? ''));
                if ($pname === 'fn' || $pname === 'org') {
                    $name = (string) ($p[3] ?? '');
                    break;
                }
            }
            if ($name === '') $name = (string) ($ent['handle'] ?? '');
            $roles[$role] = $name !== '' ? $name : ($roles[$role] ?? $role);
        }
        foreach ($roles as $role => $name) {
            $L[] = ['k' => strtoupper((string) $role), 'v' => $name];
        }
    }
    // Drop empty values (some registries omit fields like country/type).
    return array_values(array_filter($L, static fn (array $l) => $l['v'] !== ''));
}

/** Classic whois port-43 query (fallback). Returns raw text or '' on failure. */
function whois_port43(string $query): string
{
    $servers = ['whois.verisign-grs.com', 'whois.iana.org'];
    foreach ($servers as $server) {
        $fp = @fsockopen($server, 43, $errno, $errstr, 10);
        if (!$fp) continue;
        stream_set_timeout($fp, 15);
        fwrite($fp, $query . "\r\n");
        $out = '';
        while (!feof($fp)) {
            $chunk = fread($fp, 4096);
            if ($chunk === false || $chunk === '') break;
            $out .= $chunk;
        }
        fclose($fp);
        if (trim($out) !== '') return $out;
    }
    return '';
}

/** Summarise raw whois text into clean key:value lines. */
function whois_lines(string $raw): array
{
    $L = [];
    $keys = ['Domain Name', 'Registry Domain ID', 'Registrar', 'Registrar WHOIS Server', 'Registrar URL',
        'Creation Date', 'Registry Expiry Date', 'Updated Date', 'Name Server', 'DNSSEC', 'Status', 'Registrant Organization', 'Registrant Country'];
    foreach (explode("\n", $raw) as $line) {
        $line = rtrim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === '%') continue;
        foreach ($keys as $k) {
            if (stripos($line, $k . ':') === 0) {
                $v = trim(substr($line, strlen($k) + 1));
                if ($v !== '') $L[] = ['k' => strtoupper(str_replace(' ', '_', $k)), 'v' => $v];
                break;
            }
        }
    }
    if (count($L) === 0) {
        // Nothing structured — show a trimmed preview of the raw record.
        $preview = implode("\n", array_slice(array_filter(array_map('trim', explode("\n", $raw))), 0, 25));
        $L[] = ['k' => 'RAW', 'v' => $preview];
    }
    return $L;
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

$action = $_GET['action'] ?? 'lookup';

switch ($action) {
    case 'status':
        api_out([
            'ok'      => true,
            'engine'  => function_exists('curl_init') ? 'curl + RDAP' : 'streams + RDAP',
            'port43'  => function_exists('fsockopen'),
            'source'  => 'rdap.org (keyless) + whois port 43',
        ]);

    case 'lookup':
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q === '') {
            api_error('Enter a domain, IP address, or AS number.');
        }
        if (mb_strlen($q) > 255) {
            api_error('Query too long.');
        }
        $c = classify_query($q);
        if ($c['kind'] === 'unknown') {
            api_error('That does not look like a domain, IP, or ASN.');
        }

        $rdap = rdap_lookup($c['kind'], $c['value']);
        if ($rdap['ok']) {
            api_out([
                'ok'      => true,
                'query'   => $q,
                'kind'    => $c['kind'],
                'source'  => 'RDAP · ' . str_replace('https://', '', $rdap['server'] ?? 'rdap.org'),
                'lines'   => rdap_to_lines($rdap['data'], $c['kind']),
            ]);
        }

        // RDAP failed for a domain — try classic whois port 43.
        if ($c['kind'] === 'domain') {
            $raw = whois_port43($c['value']);
            if ($raw !== '') {
                api_out([
                    'ok'      => true,
                    'query'   => $q,
                    'kind'    => 'domain',
                    'source'  => 'whois port 43',
                    'lines'   => whois_lines($raw),
                ]);
            }
            api_error($rdap['error'] ?? 'Lookup failed.', 502);
        }
        api_error($rdap['error'] ?? 'Lookup failed.', 502);

    default:
        api_error('Unknown action.', 404);
}