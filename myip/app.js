/* ============================================================
   MYIP v3 — IP Recon Terminal (pro polish edition)
   ============================================================ */

const FIELDS = 'status,message,country,countryCode,regionName,city,zip,isp,org,as,timezone,lat,lon,query';
const HISTORY_KEY = 'myip_history';
const MAX_HISTORY = 20;
let scanCount = 0;
let lastData = null;
let typingTimers = [];

const $ = id => document.getElementById(id);
const output = $('output');
const errorEl = $('error');
const screen = $('screen');

// ── country name → ISO code (fallback) ──
const CC = {
  'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Andorra':'AD','Angola':'AO',
  'Argentina':'AR','Armenia':'AM','Australia':'AU','Austria':'AT','Azerbaijan':'AZ',
  'Bahamas':'BS','Bahrain':'BH','Bangladesh':'BD','Barbados':'BB','Belarus':'BY',
  'Belgium':'BE','Belize':'BZ','Benin':'BJ','Bhutan':'BT','Bolivia':'BO',
  'Bosnia and Herzegovina':'BA','Botswana':'BW','Brazil':'BR','Brunei':'BN',
  'Bulgaria':'BG','Burkina Faso':'BF','Burundi':'BI','Cambodia':'KH','Cameroon':'CM',
  'Canada':'CA','Central African Republic':'CF','Chad':'TD','Chile':'CL','China':'CN',
  'Colombia':'CO','Comoros':'KM','Congo':'CG','Costa Rica':'CR','Croatia':'HR',
  'Cuba':'CU','Cyprus':'CY','Czech Republic':'CZ','Denmark':'DK','Djibouti':'DJ',
  'Dominican Republic':'DO','DR Congo':'CD','Ecuador':'EC','Egypt':'EG',
  'El Salvador':'SV','Estonia':'EE','Ethiopia':'ET','Fiji':'FJ','Finland':'FI',
  'France':'FR','Gabon':'GA','Gambia':'GM','Georgia':'GE','Germany':'DE',
  'Ghana':'GH','Greece':'GR','Guatemala':'GT','Guinea':'GN','Guinea-Bissau':'GW',
  'Guyana':'GY','Haiti':'HT','Honduras':'HN','Hong Kong':'HK','Hungary':'HU',
  'Iceland':'IS','India':'IN','Indonesia':'ID','Iran':'IR','Iraq':'IQ',
  'Ireland':'IE','Israel':'IL','Italy':'IT','Ivory Coast':'CI','Jamaica':'JM',
  'Japan':'JP','Jordan':'JO','Kazakhstan':'KZ','Kenya':'KE','Kuwait':'KW',
  'Kyrgyzstan':'KG','Laos':'LA','Latvia':'LV','Lebanon':'LB','Liberia':'LR',
  'Libya':'LY','Lithuania':'LT','Luxembourg':'LU','Madagascar':'MG','Malawi':'MW',
  'Malaysia':'MY','Maldives':'MV','Mali':'ML','Malta':'MT','Mauritania':'MR',
  'Mauritius':'MU','Mexico':'MX','Moldova':'MD','Monaco':'MC','Mongolia':'MN',
  'Montenegro':'ME','Morocco':'MA','Mozambique':'MZ','Myanmar':'MM','Namibia':'NA',
  'Nepal':'NP','Netherlands':'NL','New Zealand':'NZ','Nicaragua':'NI','Niger':'NE',
  'Nigeria':'NG','North Korea':'KP','North Macedonia':'MK','Norway':'NO','Oman':'OM',
  'Pakistan':'PK','Palestine':'PS','Panama':'PA','Papua New Guinea':'PG',
  'Paraguay':'PY','Peru':'PE','Philippines':'PH','Poland':'PL','Portugal':'PT',
  'Qatar':'QA','Romania':'RO','Russia':'RU','Rwanda':'RW','Saudi Arabia':'SA',
  'Senegal':'SN','Serbia':'RS','Sierra Leone':'SL','Singapore':'SG','Slovakia':'SK',
  'Slovenia':'SI','Somalia':'SO','South Africa':'ZA','South Korea':'KR',
  'South Sudan':'SS','Spain':'ES','Sri Lanka':'LK','Sudan':'SD','Suriname':'SR',
  'Sweden':'SE','Switzerland':'CH','Syria':'SY','Taiwan':'TW','Tajikistan':'TJ',
  'Tanzania':'TZ','Thailand':'TH','Togo':'TG','Trinidad and Tobago':'TT',
  'Tunisia':'TN','Turkey':'TR','Turkmenistan':'TM','Uganda':'UG','Ukraine':'UA',
  'United Arab Emirates':'AE','United Kingdom':'GB','United States':'US','Uruguay':'UY',
  'Uzbekistan':'UZ','Venezuela':'VE','Vietnam':'VN','Yemen':'YE','Zambia':'ZM',
  'Zimbabwe':'ZW'
};

function codeToFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  return cc.toUpperCase().split('').map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('');
}
function countryToCode(name) { return CC[name] || ''; }

function setFlagImg(cc) {
  const img = $('flag');
  if (cc && cc.length === 2) {
    img.src = `https://flagcdn.com/w80/${cc.toLowerCase()}.png`;
    img.alt = cc.toUpperCase();
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }
}

// ── toast ──
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ── safe clipboard copy (fallback for non-HTTPS) ──
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

// ── typing animation ──
function addLine(text, cls = '') {
  const div = document.createElement('div');
  div.className = 'line ' + cls;
  output.appendChild(div);
  // typewriter effect
  let i = 0;
  const speed = cls === 'highlight' ? 18 : 10;
  function typeChar() {
    if (i < text.length) {
      div.textContent += text[i++];
      typingTimers.push(setTimeout(typeChar, speed));
    }
  }
  typeChar();
  output.scrollTop = output.scrollHeight;
}

function setText(id, value) { $(id).textContent = value || '—'; }

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

// ── beep ──
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.stop(ctx.currentTime + 0.15);
  } catch {}
}

// ── scanline sweep ──
function triggerSweep() {
  const el = $('scanSweep');
  el.classList.remove('active');
  void el.offsetWidth; // reflow
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 700);
}

// ── IP class detection ──
function getIpClass(ip) {
  if (!ip) return '';
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return '';
  if (parts[0] === 10) return { label: 'CLASS A · PRIVATE', type: 'private' };
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return { label: 'CLASS B · PRIVATE', type: 'private' };
  if (parts[0] === 192 && parts[1] === 168) return { label: 'CLASS C · PRIVATE', type: 'private' };
  if (parts[0] === 127) return { label: 'LOOPBACK', type: 'private' };
  if (parts[0] === 0) return { label: 'UNSPECIFIED', type: 'private' };
  if (parts[0] >= 224) return { label: 'MULTICAST', type: 'private' };
  if (parts[0] >= 1 && parts[0] <= 126) return { label: 'CLASS A · PUBLIC', type: 'public' };
  if (parts[0] >= 128 && parts[0] <= 191) return { label: 'CLASS B · PUBLIC', type: 'public' };
  if (parts[0] >= 192 && parts[0] <= 223) return { label: 'CLASS C · PUBLIC', type: 'public' };
  return { label: 'PUBLIC', type: 'public' };
}

// ── IP format conversions ──
function ipToFormats(ip) {
  if (!ip || ip.includes('scanning')) return;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return;

  $('ipBin').textContent = parts.map(p => p.toString(2).padStart(8, '0')).join('.');
  $('ipHex').textContent = '0x' + parts.map(p => p.toString(16).padStart(2, '0')).join('.').toUpperCase();
  $('ipOct').textContent = '0' + parts.map(p => p.toString(8)).join('.0');
  $('ipDecimal').textContent = parts.reduce((acc, p) => (acc << 8) + p, 0) >>> 0;

  // IP class
  const cls = getIpClass(ip);
  const badge = $('ipClass');
  if (cls) {
    badge.textContent = cls.label;
    badge.className = 'ip-class-badge ' + cls.type;
  }
}

// ── main fetch ──
async function fetchIP() {
  screen.classList.add('loading');
  $('stStatus').textContent = 'STATUS: SCANNING';
  errorEl.classList.add('hidden');
  $('statusbar').classList.remove('online');

  // cancel any running typing animations
  typingTimers.forEach(clearTimeout);
  typingTimers = [];

  triggerSweep();
  output.innerHTML = '';

  addLine('// initiating network reconnaissance…', 'dim');
  addLine('// target: ip-api.com/json', 'dim');

  const t0 = performance.now();

  try {
    const res = await fetch(`http://ip-api.com/json/?fields=${FIELDS}`);
    const data = await res.json();
    const latency = Math.round(performance.now() - t0);

    if (data.status === 'fail') throw new Error(data.message || 'API failure.');

    addLine('// handshake complete ✓', 'dim');
    addLine('// acquired target: ' + data.query, 'highlight');
    addLine(`// latency: ${latency}ms`, 'dim');

    $('latency').textContent = `latency: ${latency}ms`;
    updateQuality(latency);

    scrambleIP(data.query, 'ip');
    ipToFormats(data.query);

    const cc = data.countryCode || countryToCode(data.country) || '';
    setFlagImg(cc);
    setText('country', data.country);
    setText('region', data.regionName);
    setText('city', data.city);
    setText('zip', data.zip);
    setText('isp', data.isp);
    setText('org', data.org);
    setText('as', data.as);
    setText('timezone', data.timezone);
    setText('lat', data.lat);
    setText('lon', data.lon);

    lastData = { ...data, latency };

    loadMap(data.lat, data.lon);
    addLine('// map feed locked ✓', 'dim');

    fetchIPv6();
    reverseDns(data.query);
    detectVpnTor(data.query);
    checkWebRTC(data.query);
    saveHistory(data);

    scanCount++;
    $('stJobs').textContent = `scans: ${scanCount}`;
    document.querySelector('.hero-card').classList.add('loaded');
    setTimeout(() => document.querySelector('.hero-card').classList.remove('loaded'), 700);
    $('stStatus').textContent = 'STATUS: ONLINE';
    $('stStatus').style.color = 'var(--fg)';
    $('statusbar').classList.add('online');

    beep();
  } catch (err) {
    addLine('// ERROR: ' + err.message, 'dim');
    $('stStatus').textContent = 'STATUS: ERROR';
    $('stStatus').style.color = 'var(--danger)';
    showError(err.message || 'Network error. Please try again.');
  } finally {
    screen.classList.remove('loading');
  }
}

// ── IPv6 ──
async function fetchIPv6() {
  try {
    const res = await fetch('https://ipv6.ip-api.com/json/?fields=query');
    const data = await res.json();
    if (data.status === 'success' && data.query) {
      addLine('// IPv6 acquired: ' + data.query, 'highlight');
      scrambleIP(data.query, 'ip6');
    } else {
      setText('ip6', 'unavailable');
      addLine('// IPv6 not available on this network', 'dim');
    }
  } catch {
    setText('ip6', 'unavailable');
    addLine('// IPv6 lookup failed', 'dim');
  }
}

// ── reverse DNS ──
async function reverseDns(ip) {
  const el = $('reverseDns');
  el.textContent = 'resolving…';
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=hostname`);
    const data = await res.json();
    if (data.hostname) {
      el.textContent = data.hostname;
      el.className = 'sec-val safe';
      addLine('// reverse DNS: ' + data.hostname, 'dim');
    } else {
      el.textContent = 'no PTR record';
      el.className = 'sec-val';
    }
  } catch {
    el.textContent = 'lookup failed';
    el.className = 'sec-val';
  }
}

// ── VPN / proxy / Tor detection ──
async function detectVpnTor(ip) {
  const vpnEl = $('vpnStatus');
  const torEl = $('torStatus');
  vpnEl.textContent = 'checking…';
  torEl.textContent = 'checking…';

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=isp,org,as,proxy`);
    const data = await res.json();

    const isProxy = data.proxy === true;
    const text = (data.isp + ' ' + data.org).toLowerCase();
    const isVpn = isProxy || /vpn|tunnel|proxy|cloudflare|hosting|datacenter|digitalocean|aws|azure|google cloud|alibaba/i.test(text);
    const isTor = /tor|onion|niciro/i.test(text);

    if (isTor) {
      torEl.textContent = 'DETECTED ⚠';
      torEl.className = 'sec-val danger';
      addLine('// ⚠ TOR exit node detected', 'dim');
    } else {
      torEl.textContent = 'clear ✓';
      torEl.className = 'sec-val safe';
    }

    if (isVpn) {
      vpnEl.textContent = 'DETECTED ⚠';
      vpnEl.className = 'sec-val warn';
      addLine('// ⚠ VPN/proxy detected', 'dim');
    } else {
      vpnEl.textContent = 'clear ✓';
      vpnEl.className = 'sec-val safe';
    }
  } catch {
    vpnEl.textContent = 'unknown';
    torEl.textContent = 'unknown';
  }
}

// ── WebRTC leak check ──
async function checkWebRTC(publicIp) {
  const el = $('webrtcStatus');
  el.textContent = 'checking…';

  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    pc.createOffer().then(offer => pc.setLocalDescription(offer));

    let leaked = false;
    let webrtcIp = '';

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.candidate;
      const match = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match && match[1] !== '0.0.0.0') {
        webrtcIp = match[1];
        if (webrtcIp !== publicIp) leaked = true;
      }
    };

    setTimeout(() => {
      pc.close();
      if (leaked) {
        el.textContent = `LEAKED: ${webrtcIp}`;
        el.className = 'sec-val danger';
        addLine(`// ⚠ WebRTC leak detected: ${webrtcIp}`, 'dim');
      } else {
        el.textContent = 'secure ✓';
        el.className = 'sec-val safe';
      }
    }, 2000);
  } catch {
    el.textContent = 'unavailable';
    el.className = 'sec-val';
  }
}

// ── scramble animation ──
const CHARS = '0123456789abcdef.:ABCDEF';
let scrambleTimers = {};

function scrambleIP(target, elId) {
  const el = $(elId);
  const len = target.length;
  let ticks = 0;
  const totalTicks = Math.min(10 + len * 2, 30);

  const indices = [...Array(len).keys()];
  indices.sort((a, b) => {
    const distA = Math.abs(a - (len - 1) / 2);
    const distB = Math.abs(b - (len - 1) / 2);
    return distB - distA;
  });
  const posLockTick = new Array(len).fill(totalTicks);
  indices.forEach((pos, rank) => {
    posLockTick[pos] = Math.floor(totalTicks * (0.2 + 0.8 * (rank / len)));
  });

  if (scrambleTimers[elId]) clearInterval(scrambleTimers[elId]);
  el.classList.add('scrambling');

  scrambleTimers[elId] = setInterval(() => {
    let display = '';
    for (let i = 0; i < len; i++) {
      display += ticks >= posLockTick[i]
        ? target[i]
        : CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    el.textContent = display;
    ticks++;
    if (ticks > totalTicks) {
      el.textContent = target;
      el.classList.remove('scrambling');
      clearInterval(scrambleTimers[elId]);
      delete scrambleTimers[elId];
    }
  }, 35);
}

// ── map ──
function loadMap(lat, lon) {
  if (!lat || !lon) return;
  $('mapPlaceholder').classList.add('hidden');
  $('mapFrame').src = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.04},${lat - 0.02},${lon + 0.04},${lat + 0.02}&layer=mapnik&marker=${lat},${lon}`;
  $('mapFrame').classList.remove('hidden');
  const linkBtn = $('mapLink');
  linkBtn.classList.remove('hidden');
  linkBtn.onclick = () => window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`, '_blank');
}

// ── history ──
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveHistory(data) {
  const history = getHistory();
  history.unshift({
    ip: data.query,
    country: data.country,
    countryCode: data.countryCode || countryToCode(data.country) || '',
    city: data.city,
    isp: data.isp,
    time: new Date().toLocaleTimeString()
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const lists = document.querySelectorAll('.history-list');
  const history = getHistory();
  const html = !history.length
    ? '<div class="history-empty">// no scan history yet</div>'
    : history.map(h => {
        const flag = codeToFlag(h.countryCode);
        return `<div class="history-item" data-ip="${h.ip}">
          <span class="hist-time">${h.time}</span>
          <span class="hist-ip">${flag ? flag + ' ' : ''}${h.ip}</span>
          <span class="hist-loc">${h.city || ''}</span>
        </div>`;
      }).join('');

  lists.forEach(list => {
    list.innerHTML = html;
    list.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        copyText(item.dataset.ip);
        toast('Copied: ' + item.dataset.ip);
      });
    });
  });
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  toast('History cleared');
}

// ── export ──
function exportResults() {
  if (!lastData) { showError('No data to export. Run a scan first.'); return; }

  const report = [
    '═══════════════════════════════════════',
    '  MYIP v3 — Recon Report',
    '  ' + new Date().toLocaleString(),
    '═══════════════════════════════════════',
    '',
    `IPv4:      ${lastData.query}`,
    `Binary:    ${$('ipBin').textContent}`,
    `Hex:       ${$('ipHex').textContent}`,
    `Octal:     ${$('ipOct').textContent}`,
    `Decimal:   ${$('ipDecimal').textContent}`,
    `Class:     ${$('ipClass').textContent}`,
    '',
    `Country:   ${lastData.country} (${lastData.countryCode || countryToCode(lastData.country) || '??'})`,
    `Region:    ${lastData.regionName}`,
    `City:      ${lastData.city}`,
    `ZIP:       ${lastData.zip}`,
    `ISP:       ${lastData.isp}`,
    `Org:       ${lastData.org}`,
    `AS:        ${lastData.as}`,
    `Timezone:  ${lastData.timezone}`,
    `Lat:       ${lastData.lat}`,
    `Lon:       ${lastData.lon}`,
    `Latency:   ${lastData.latency}ms`,
    '',
    `Reverse DNS: ${$('reverseDns').textContent}`,
    `VPN/Proxy:   ${$('vpnStatus').textContent}`,
    `Tor Exit:    ${$('torStatus').textContent}`,
    `WebRTC:      ${$('webrtcStatus').textContent}`,
    ...(lastSpeed ? [
      '',
      '── Speed Test ──',
      `Download: ${fmtMbps(lastSpeed.down || 0)} Mbps`,
      `Upload:   ${fmtMbps(lastSpeed.up || 0)} Mbps`,
      `Latency:  ${lastSpeed.latency}ms`,
      `Jitter:   ${lastSpeed.jitter}ms`,
      `Grade:    ${lastSpeed.grade.g} — ${lastSpeed.grade.label}`,
      `Tested:   ${new Date(lastSpeed.time).toLocaleString()}`
    ] : []),
    '',
    '═══════════════════════════════════════',
    '  Generated by MYIP Recon Terminal',
    '═══════════════════════════════════════'
  ].join('\n');

  const blob = new Blob([report], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `myip-report-${lastData.query}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  addLine('// report exported ✓', 'dim');
  toast('Report downloaded');
}

// ── copy buttons ──
function setupCopy(btnId, ipId) {
  $(btnId).addEventListener('click', () => {
    const ip = $(ipId).textContent;
    if (!ip || ip.startsWith('scanning') || ip === '—' || ip === 'unavailable') return;
    copyText(ip).then(() => {
      const btn = $(btnId);
      btn.textContent = '✓';
      btn.classList.add('copied');
      toast('Copied: ' + ip);
      setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('copied'); }, 1500);
    });
  });
}
setupCopy('copyBtn', 'ip');
setupCopy('copyBtn6', 'ip6');

// ── click-to-copy on data cells ──
document.querySelectorAll('.data-cell').forEach(cell => {
  cell.addEventListener('click', () => {
    const val = cell.querySelector('.data-val');
    if (val && val.textContent && val.textContent !== '—') {
      copyText(val.textContent);
      toast('Copied: ' + val.textContent);
    }
  });
});

// ── click-to-copy on IP format rows ──
document.querySelectorAll('.ip-fmt-row').forEach(row => {
  row.addEventListener('click', () => {
    const val = row.querySelector('.ip-fmt-val');
    if (val && val.textContent && val.textContent !== '—') {
      copyText(val.textContent);
      toast('Copied: ' + val.textContent);
    }
  });
});

// ── speed test ──
const PING_SERVERS = [
  { name: 'Cloudflare',    url: 'https://1.1.1.1/cdn-cgi/trace' },
  { name: 'Google',        url: 'https://www.google.com/favicon.ico' },
  { name: 'GitHub',        url: 'https://github.com/favicon.ico' },
  { name: 'Cloudfront',    url: 'https://d1q37jz6a3jki0.cloudfront.net/technical.md' },
  { name: 'DigitalOcean',  url: 'https://speedtest-blr1.digitalocean.com/' }
];
const MB = 1_000_000;
const PING_SAMPLES = 3;          // timed samples per server (after 1 warmup)
const DL_MIN = 4, DL_MAX = 64;   // main download payload bounds (MB)
const UP_MIN = 2, UP_MAX = 32;   // main upload payload bounds (MB)
let lastSpeed = null;

const speedPhaseEl = $('speedPhaseTab');
const speedGradeEl = $('speedGradeTab');

function setPhase(msg) { if (speedPhaseEl) speedPhaseEl.textContent = msg; }

function fmtMbps(m) { return m >= 100 ? m.toFixed(0) : m.toFixed(1); }
function sizeLabel(bytes) {
  const mb = bytes / MB;
  return mb >= 10 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB';
}

// fetch with a hard timeout (aborts hung servers so one bad host can't stall the test)
function fetchWithTimeout(url, opts = {}, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// warmup + N timed samples against one host; returns the min RTT (standard for latency)
async function pingServer(s) {
  const samples = [];
  try { await fetchWithTimeout(s.url, { mode: 'no-cors', cache: 'no-store' }, 4000); } catch {}
  for (let i = 0; i < PING_SAMPLES; i++) {
    const t0 = performance.now();
    try { await fetchWithTimeout(s.url, { mode: 'no-cors', cache: 'no-store' }, 4000); } catch {}
    samples.push(Math.round(performance.now() - t0));
  }
  return { name: s.name, min: Math.min(...samples), samples };
}

// stream a __down payload of `bytes` bytes; onProgress(received, ms) fires per chunk
async function timedDownload(bytes, onProgress, timeoutMs = 45000) {
  const t0 = performance.now();
  let received = 0;
  try {
    const res = await fetchWithTimeout(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { cache: 'no-store' }, timeoutMs);
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (onProgress) onProgress(received, performance.now() - t0);
    }
    const ms = performance.now() - t0;
    // floor catches cache/proxy zero-time hits; must not reject fast fiber links
    if (ms < 30 || received < 10000) return null;
    return { mbps: (received * 8) / ms / 1000, bytes: received, ms };
  } catch { return null; }
}

// PUT `bytes` bytes to __up; onProgress(bytes, ms) ticks ~5x/sec for the phase line
async function timedUpload(bytes, onProgress, timeoutMs = 45000) {
  const body = new Uint8Array(bytes);
  const t0 = performance.now();
  let ticker = null;
  if (onProgress) {
    ticker = setInterval(() => { const ms = performance.now() - t0; if (ms > 0) onProgress(bytes, ms); }, 200);
  }
  try {
    const res = await fetchWithTimeout(`https://speed.cloudflare.com/__up?bytes=${bytes}`, { method: 'PUT', body, cache: 'no-store' }, timeoutMs);
    const ms = performance.now() - t0;
    return res.ok ? { mbps: (bytes * 8) / ms / 1000, bytes, ms } : null;
  } catch { return null; }
  finally { if (ticker) clearInterval(ticker); }
}

// adaptive download: quick 0.5MB probe → mid probe sized to ~2.5s → main run sized to ~2.5s
async function runDownloadPhase(barStart, barEnd) {
  const fill = f => { $('pingFillTab').style.width = Math.round((barStart + (barEnd - barStart) * Math.min(1, Math.max(0, f))) * 100) + '%'; };
  setPhase('probing download…');
  const p1 = await timedDownload(0.5 * MB, (b, ms) => { $('speedDownTab').textContent = fmtMbps((b * 8) / ms / 1000) + ' Mbps'; fill(0.10); }, 15000);
  if (!p1) return null;
  const midSize = Math.min(8, Math.max(1, Math.round((p1.mbps * 2.5) / 8)));
  const p2 = await timedDownload(midSize * MB, (b, ms) => { $('speedDownTab').textContent = fmtMbps((b * 8) / ms / 1000) + ' Mbps'; fill(0.25 + 0.25 * (b / (midSize * MB))); }, 25000);
  const est = Math.max(p1.mbps, p2 ? p2.mbps : 0);
  const mainSize = Math.min(DL_MAX, Math.max(DL_MIN, Math.round((est * 2.5) / 8)));
  setPhase(`downloading ${sizeLabel(mainSize * MB)}…`);
  const main = await timedDownload(mainSize * MB, (b, ms) => {
    $('speedDownTab').textContent = fmtMbps((b * 8) / ms / 1000) + ' Mbps';
    fill(0.5 + 0.5 * (b / (mainSize * MB)));
  });
  return main || p2 || p1;
}

// adaptive upload: 1MB probe → main run sized to ~2.5s
async function runUploadPhase(barStart, barEnd) {
  const fill = f => { $('pingFillTab').style.width = Math.round((barStart + (barEnd - barStart) * Math.min(1, Math.max(0, f))) * 100) + '%'; };
  setPhase('probing upload…');
  const p1 = await timedUpload(1 * MB, null, 20000);
  if (!p1) return null;
  const mainSize = Math.min(UP_MAX, Math.max(UP_MIN, Math.round((p1.mbps * 2.5) / 8)));
  setPhase(`uploading ${sizeLabel(mainSize * MB)}…`);
  const main = await timedUpload(mainSize * MB, (bytes, ms) => {
    const expected = (bytes / 8) / p1.mbps * 1000; // ms at probe rate
    fill(0.4 + 0.6 * Math.min(1, ms / expected));
    setPhase(`uploading… ${Math.min(99, Math.round((ms / expected) * 100))}%`);
  });
  return main || p1;
}

function computeGrade(down, latency) {
  if (down === null) {
    if (latency < 100) return { g: 'B', label: 'B · GOOD' };
    if (latency < 250) return { g: 'C', label: 'C · OK' };
    return { g: 'E', label: 'E · POOR' };
  }
  if (down >= 100) return { g: 'S', label: 'S · FIBER' };
  if (down >= 50)  return { g: 'A', label: 'A · FAST' };
  if (down >= 25)  return { g: 'B', label: 'B · GOOD' };
  if (down >= 10)  return { g: 'C', label: 'C · OK' };
  if (down >= 4)   return { g: 'D', label: 'D · SLOW' };
  return { g: 'E', label: 'E · VERY SLOW' };
}

const GRADE_COLORS = { S: 'var(--fg)', A: 'var(--fg)', B: 'var(--accent)', C: 'var(--warning)', D: 'var(--danger)', E: 'var(--danger)' };

async function runSpeedTest() {
  if ($('btnSpeedTestTab').disabled) return;
  const btn = $('btnSpeedTestTab');
  btn.disabled = true;
  btn.textContent = '⏳ TESTING';
  addLine('// initiating speed & latency test…', 'dim');

  ['speedDownTab', 'speedUpTab', 'speedJitterTab', 'speedLatencyTab'].forEach(id => {
    $(id).textContent = '…';
    $(id).classList.add('testing');
  });
  speedGradeEl.textContent = '—';
  speedGradeEl.style.color = '';
  $('speedServersTab').innerHTML = '';
  $('pingFillTab').style.width = '0%';

  // ── phase 1: latency + jitter (parallel, min-of-3 per host) ──
  setPhase('ping phase — 5 servers × 3 samples…');
  let done = 0;
  const pings = await Promise.all(PING_SERVERS.map(async s => {
    const r = await pingServer(s);
    done++;
    $('pingFillTab').style.width = Math.round((done / PING_SERVERS.length) * 30) + '%';
    addLine(`// ping ${r.name}: ${r.min}ms (min of ${PING_SAMPLES})`, 'dim');
    return r;
  }));

  const latency = Math.round(pings.reduce((a, r) => a + r.min, 0) / pings.length);
  let jitterSum = 0, jitterN = 0;
  pings.forEach(r => {
    for (let i = 1; i < r.samples.length; i++) {
      jitterSum += Math.abs(r.samples[i] - r.samples[i - 1]);
      jitterN++;
    }
  });
  const jitter = jitterN ? Math.round(jitterSum / jitterN) : 0;

  $('speedLatencyTab').textContent = latency + 'ms';
  $('speedLatencyTab').classList.remove('testing');
  $('speedJitterTab').textContent = jitter + 'ms';
  $('speedJitterTab').classList.remove('testing');
  addLine(`// avg latency: ${latency}ms · jitter: ${jitter}ms`, 'highlight');

  const maxPing = Math.max(...pings.map(p => p.min), 1);
  $('speedServersTab').innerHTML = pings.map(p => {
    const pct = Math.min(100, (p.min / maxPing) * 100);
    const color = p.min < 50 ? 'var(--fg)' : p.min < 150 ? 'var(--warning)' : 'var(--danger)';
    return `<div class="ping-row">
      <span class="ping-name">${p.name}</span>
      <span class="ping-ms" style="color:${color}">${p.min}ms</span>
      <div class="ping-bar-wrap"><div class="ping-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');

  // ── phase 2: download (adaptive) ──
  setPhase('probing download…');
  const down = await runDownloadPhase(0.30, 0.65);
  if (down) {
    $('speedDownTab').textContent = fmtMbps(down.mbps) + ' Mbps';
    addLine(`// download: ${fmtMbps(down.mbps)} Mbps (${sizeLabel(down.bytes)} sample)`, 'highlight');
  } else {
    $('speedDownTab').textContent = 'failed';
    addLine('// download: failed (blocked or timed out)', 'dim');
  }
  $('speedDownTab').classList.remove('testing');

  // ── phase 3: upload (adaptive) ──
  setPhase('probing upload…');
  const up = await runUploadPhase(0.65, 1.0);
  if (up) {
    $('speedUpTab').textContent = fmtMbps(up.mbps) + ' Mbps';
    addLine(`// upload: ${fmtMbps(up.mbps)} Mbps (${sizeLabel(up.bytes)} sample)`, 'highlight');
  } else {
    $('speedUpTab').textContent = 'failed';
    addLine('// upload: failed (blocked or timed out)', 'dim');
  }
  $('speedUpTab').classList.remove('testing');

  // ── summary ──
  const grade = computeGrade(down ? down.mbps : null, latency);
  speedGradeEl.textContent = grade.label;
  speedGradeEl.style.color = GRADE_COLORS[grade.g];
  speedGradeEl.style.borderColor = GRADE_COLORS[grade.g];
  lastSpeed = { down: down ? down.mbps : null, up: up ? up.mbps : null, latency, jitter, grade, time: new Date().toISOString() };

  $('pingFillTab').style.width = '100%';
  setPhase('complete — press RUN to retest');
  addLine(`// GRADE ${grade.g} — ${grade.label} (${fmtMbps(down ? down.mbps : 0)}↓ ${fmtMbps(up ? up.mbps : 0)}↑ · ${latency}ms)`, 'highlight');
  btn.disabled = false;
  btn.textContent = '▶ RUN';
  beep();
  toast(`Speed test: ${fmtMbps(down ? down.mbps : 0)}↓ ${fmtMbps(up ? up.mbps : 0)}↑ · ${latency}ms · ${grade.g}`);
}

$('btnSpeedTestTab').addEventListener('click', runSpeedTest);

// ── tab switching ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
}
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ── theme toggle ──
const THEME_KEY = 'myip_theme';

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light');
    $('btnTheme').textContent = '● DARK';
  } else {
    document.body.classList.remove('light');
    $('btnTheme').textContent = '☀ LIGHT';
  }
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const current = document.body.classList.contains('light') ? 'light' : 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
  toast('Theme: ' + (current === 'dark' ? 'light' : 'dark'));
}

applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
$('btnTheme').addEventListener('click', toggleTheme);

// ── fullscreen ──
function toggleFullscreen() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    toast('Fullscreen on');
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    toast('Fullscreen off');
  }
}
$('btnFullscreen').addEventListener('click', toggleFullscreen);

// ── buttons ──
$('btnRefresh').addEventListener('click', fetchIP);
$('btnExport').addEventListener('click', exportResults);
if ($('btnClearHistory')) $('btnClearHistory').addEventListener('click', clearHistory);
if ($('btnClearHistoryTab')) $('btnClearHistoryTab').addEventListener('click', clearHistory);

// ── keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  if (key === 'r') { e.preventDefault(); fetchIP(); }
  else if (key === 'c') { e.preventDefault(); copyText($('ip').textContent); toast('Copied IP'); }
  else if (key === 'e') { e.preventDefault(); exportResults(); }
  else if (key === 't') { e.preventDefault(); toggleTheme(); }
  else if (key === 'f') { e.preventDefault(); toggleFullscreen(); }
  else if (key === 's') { e.preventDefault(); switchTab('speed'); runSpeedTest(); }
});

// ── connection quality ──
function updateQuality(latency) {
  const el = $('stQuality');
  const txt = $('stQualityText');
  const bars = el.querySelectorAll('.bar');
  el.classList.remove('great', 'good', 'poor');
  bars.forEach(b => b.classList.remove('on', 'warn', 'off'));

  if (latency < 0) {
    el.classList.add('poor');
    txt.textContent = 'NO SIGNAL';
    return;
  }

  if (latency < 80) {
    el.classList.add('great');
    txt.textContent = `${latency}ms · EXCELLENT`;
    bars.forEach(b => b.classList.add('on'));
  } else if (latency < 200) {
    el.classList.add('good');
    txt.textContent = `${latency}ms · GOOD`;
    bars[0].classList.add('on');
    bars[1].classList.add('on');
    bars[2].classList.add('on');
    bars[3].classList.add('warn');
  } else {
    el.classList.add('poor');
    txt.textContent = `${latency}ms · POOR`;
    bars[0].classList.add('on');
    bars[1].classList.add('warn');
  }
}

// ── clock ──
function tickClock() {
  const now = new Date();
  $('stClock').textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}
tickClock();
setInterval(tickClock, 1000);

// ── init ──
renderHistory();
fetchIP();
