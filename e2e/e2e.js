// Uji end-to-end di browser sungguhan (Chromium via Playwright), data live.
// Jalankan: npm run test:e2e            (default: https://sigap-laut.vercel.app)
//           BASE_URL=http://localhost:3000 npm run test:e2e
// Butuh Playwright terpasang (require('playwright')) dan akses jaringan ke situs,
// Open-Meteo, BMKG, unpkg.com dan tile.openstreetmap.org.
const { chromium } = require('playwright');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const R = require('../lib/route.js');
const fmt1 = v => (v == null || !Number.isFinite(v)) ? '–' : v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtT = ms => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const LBL = { g: 'aman', a: 'waspada', r: 'tidak disarankan' };

// Bandingkan tabel per waypoint dengan data mentah /api/forecast (indeks jam dihitung sendiri, bukan oleh aplikasi).
function dataAccuracy(json, wps, depart, speed, margin, ship, table) {
  const smp = R.buildSamples(wps), t0 = json.t[0] * 1000, bad = [];
  let n = 0;
  smp.forEach((p, i) => {
    if (p.wp == null) return;
    const eta = depart + p.cum / speed * 3600e3, k = Math.round((eta - t0) / 3600e3), P = json.points[i];
    const v = f => (k < 0 || k >= json.t.length || P[f][k] == null) ? null : P[f][k];
    const hx = v('hx'), hn = v('hn'), w = v('w'), g = v('g'), cur = v('cur');
    const exp = [
      fmtT(eta),
      hn != null && hx != null && hx - hn >= 0.05 ? fmt1(hn) + '–' + fmt1(hx) : fmt1(hx),
      w == null ? '–' : Math.round(w) + (g != null ? ' (' + Math.round(g) + ')' : ''),
      fmt1(cur)
    ];
    const vd = R.verdict({ hs: hx, w, cur }, margin, ship);
    exp.push(vd === 'x' ? '–' : LBL[vd]);
    const row = table[n++] || [];
    const got = [row[1], row[2], row[3], row[4], (row[5] || '').trim()];
    exp.forEach((e, j) => { if (got[j] !== e) bad.push(`WP${p.wp + 1} kolom ${j + 1}: tampil "${got[j]}" seharusnya "${e}"`); });
  });
  return { checked: n, bad };
}

const BASE = process.env.BASE_URL || 'https://sigap-laut.vercel.app';
// Untuk menguji preview yang dilindungi Vercel Authentication: set VERCEL_AUTOMATION_BYPASS_SECRET
// (dari "Protection Bypass for Automation"). Dikirim sebagai query pada navigasi pertama (bukan header),
// agar Vercel menyetel cookie bypass dan header kustom tidak bocor ke permintaan lintas-asal (mis. font → CORS).
const BYPASS_Q = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? (BASE.includes('?') ? '&' : '?') + 'x-vercel-protection-bypass=' + encodeURIComponent(process.env.VERCEL_AUTOMATION_BYPASS_SECRET) + '&x-vercel-set-bypass-cookie=true'
  : '';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const SCENARIOS = [
  // Rute uji tunggal: Batam (Sekupang) → Jakarta (Tanjung Priok / Pondok Dayung), contoh rute pertama di aplikasi.
  {
    id: 'batam-jakarta-sarat4',
    name: 'Batam → Jakarta, sarat 4 m',
    ship: { sName: 'KRI Uji Sarat 4', sSpeed: '15', sHs: '2.5', sCur: '2', sWind: '30', sDraft: '4', sUkc: '1.5', sRange: '3000' },
    preset: '0',
    viewports: ['hp', 'desktop'],
    expect: { wps: 30, ports: ['Sekupang', 'Tanjung Priok'], depth: 'a', sharedCell: true }
  },
  {
    id: 'batam-jakarta-sarat8',
    name: 'Batam → Jakarta, sarat 8 m',
    ship: { sName: 'KRI Uji Sarat 8', sSpeed: '15', sHs: '2.5', sCur: '2', sWind: '30', sDraft: '8', sRange: '3000' },
    preset: '0',
    viewports: ['desktop'],
    expect: { wps: 30, ports: ['Sekupang', 'Tanjung Priok'], depth: 'r', sharedCell: true }
  }
];
const VIEWPORTS = [
  { id: 'hp', width: 390, height: 844, isMobile: true, hasTouch: true },
  { id: 'desktop', width: 1440, height: 900 }
];

async function run(browser, sc, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => { if (!/tile\.openstreetmap/.test(r.url())) errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText); });
  const apiStatus = {};
  let forecastJson = null;
  page.on('response', r => {
    const u = r.url(); if (!u.includes('/api/')) return;
    apiStatus[new URL(u).pathname] = r.status();
    if (u.includes('/api/forecast') && r.status() === 200) r.json().then(j => { forecastJson = j; }).catch(() => {});
  });

  // Navigasi antar tahap lewat stepper, lalu tunggu tahap aktif.
  const step = async name => { await page.click(`.step[data-go="${name}"]`); await page.waitForFunction(n => document.querySelector('main').dataset.stage === n, name, { timeout: 15000 }); };

  await page.goto(BASE + BYPASS_Q, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#shipForm', { state: 'visible', timeout: 30000 });
  await page.waitForSelector('#splash', { state: 'detached', timeout: 6000 }).catch(() => {});

  // TAHAP 1 — KAPAL (simpan lalu auto-lanjut ke Rute)
  for (const [id, v] of Object.entries(sc.ship)) await page.fill('#' + id, v);
  await page.click('#shipForm button[type=submit]');
  await page.waitForFunction(() => document.querySelector('main').dataset.stage === 'route', null, { timeout: 15000 });
  await page.waitForSelector('.leaflet-container .leaflet-tile-loaded', { timeout: 30000 });

  // TAHAP 2 — RUTE
  if (sc.preset != null) {
    await page.selectOption('#preset', sc.preset);
  } else {
    await page.click('#clearWp');
    for (let i = 0; i < sc.wps.length; i++) await page.click('#addWp');
    for (let i = 0; i < sc.wps.length; i++) {
      for (let k = 0; k < 2; k++) {
        const sel = `#wps input[data-i="${i}"][data-k="${k}"]`;
        await page.fill(sel, sc.wps[i][k]);
        await page.locator(sel).dispatchEvent('change');
      }
    }
  }
  // Huruf/sentuh kontrol diperiksa di tahap Rute (banyak isian koordinat yang terlihat).
  const uxFont = await page.evaluate(() => {
    const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const small = [...document.querySelectorAll('.panel button, .panel input, .panel select')].filter(vis).filter(el => el.type !== 'checkbox' && el.getBoundingClientRect().height < 40).map(el => el.id || el.className || el.tagName);
    const tinyFont = [...document.querySelectorAll('input, select')].filter(vis).filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.tagName);
    return { small, tinyFont };
  });

  // TAHAP 3 — HITUNG, lalu TAHAP 4 — INTELIJEN (prakiraan diambil saat masuk)
  await step('calc');
  await step('intel');
  await page.waitForSelector('#status .pill', { timeout: 60000 });
  await page.waitForFunction(() => !/Mengambil/.test(document.querySelector('#bmkgList').textContent), null, { timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  const r = await page.evaluate(() => {
    const strokes = [...document.querySelectorAll('.leaflet-overlay-pane path')].map(p => p.getAttribute('stroke'));
    return {
      status: document.querySelector('#status .pill').textContent,
      statusText: document.querySelector('#status').innerText,
      meta: document.querySelector('#meta').textContent,
      routeColors: [...new Set(strokes.filter(s => ['#16a05a', '#e2a100', '#d33f3f', '#9aa7b6'].includes(s)))],
      segs: strokes.length,
      rows: document.querySelectorAll('#tbl tbody tr').length,
      slots: [...document.querySelectorAll('#win .slot')].map(b => b.className.replace('slot', '').trim() + '@' + b.innerText.split('\n')[0]),
      brief: document.querySelector('#brief').textContent,
      bmkg: document.querySelector('#bmkgList').innerText.split('\n')[0],
      msg: document.querySelector('#msg').textContent,
      wps: document.querySelectorAll('#wps .wp').length,
      dq: [...document.querySelectorAll('#status .note.dq')].map(n => n.textContent),
      depth: [...document.querySelectorAll('#status .note.depth')].map(n => n.textContent),
      depthBad: document.querySelectorAll('#status .note.depth.bad').length,
      depthMarkers: [...document.querySelectorAll('.leaflet-overlay-pane path')].filter(p => p.getAttribute('stroke') === '#0b2545' && ['#d33f3f', '#e2a100', '#3b2a1a'].includes(p.getAttribute('fill'))).length,
      ports: (document.querySelector('#status .note.port') || {}).textContent || '',
      portLinks: [...document.querySelectorAll('#status .note.port a')].map(a => a.href).filter(h => h.includes('/cuaca/maritim/pelabuhan/')),
      routePx: (() => { const bs = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter(p => ['#16a05a', '#e2a100', '#d33f3f', '#9aa7b6'].includes(p.getAttribute('stroke'))).map(p => p.getBoundingClientRect());
        if (!bs.length) return 0; return Math.max(Math.max(...bs.map(b => b.right)) - Math.min(...bs.map(b => b.left)), Math.max(...bs.map(b => b.bottom)) - Math.min(...bs.map(b => b.top))); })(),
      windFailed: /model angin gagal/.test(document.querySelector('#status').innerText),
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });

  // Ketepatan data: tabel vs data mentah API.
  const inp = await page.evaluate(() => ({
    wps: JSON.parse(localStorage.getItem('sl-state')).wps,
    depart: document.querySelector('#depart').value, speed: +document.querySelector('#speed').value, margin: +document.querySelector('#margin').value,
    table: [...document.querySelectorAll('#tbl tbody tr')].map(tr => [...tr.cells].map(td => td.textContent))
  }));
  const ship = { hs: +sc.ship.sHs, speed: +sc.ship.sSpeed, wind: +sc.ship.sWind || null, cur: +sc.ship.sCur || null };
  const acc = forecastJson ? dataAccuracy(forecastJson, inp.wps, Date.parse(inp.depart + ':00+07:00'), inp.speed, inp.margin, ship, inp.table) : { checked: 0, bad: ['respons /api/forecast tidak tertangkap'] };
  const hasCells = !!(forecastJson && forecastJson.points[0] && forecastJson.points[0].cell);

  // Khusus HP: ukuran sentuh & huruf kolom isian (iOS memperbesar layar bila < 16 px).
  const ux = await page.evaluate(() => {
    const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const small = [...document.querySelectorAll('.panel button, .panel input, .panel select')].filter(vis)
      .filter(el => el.type !== 'checkbox' && el.getBoundingClientRect().height < 40).map(el => el.id || el.className || el.tagName);
    const tinyFont = [...document.querySelectorAll('input, select')].filter(vis).filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.tagName);
    const dots = [...document.querySelectorAll('#tbl tbody tr td:first-child .dot')];
    const dotsVisible = dots.length > 0 && dots.every(d => { const b = d.getBoundingClientRect(); return b.width > 0 && b.right <= window.innerWidth; });
    const labels = [...document.querySelectorAll('.leaflet-tooltip-pane .leaflet-tooltip')].length;
    const rowsTxt = [...document.querySelectorAll('#tbl tbody tr')].map(tr => [...tr.cells].map(td => td.textContent));
    const legsOk = rowsTxt.length > 1 && rowsTxt.slice(0, -1).every(r => /^\d{3}\.\d°$/.test(r[6]) && /^\d+,\d$/.test(r[7])) && rowsTxt[rowsTxt.length - 1][6] === '–';
    const bmkgCorr = /±10 NM/.test(document.querySelector('#bmkgList').innerText);
    const encOk = [...document.querySelectorAll('#bmkgList .enc')].every(x => /kapal tiba ±.* WIB · (BERLAKU saat kapal melintas|berakhir sebelum kapal tiba|belum berlaku saat kapal tiba)/.test(x.textContent));
    const marLink = !!document.querySelector('#status a[href="https://maritim.bmkg.go.id/"]');
    return { small, tinyFont, count: document.querySelector('#wpCount').textContent, dotsVisible, labels, legsOk, bmkgCorr, encOk, marLink };
  });

  ux.small = uxFont.small; ux.tinyFont = uxFont.tinyFont;   // periksa kontrol tahap Rute, bukan hanya Intelijen

  const shot = path.join(OUT, `${sc.id}-${vp.id}.png`);
  await page.screenshot({ path: shot, fullPage: vp.id === 'hp' });

  // Interaksi lanjutan (sadar-tahap). #tbl ada di tahap Intelijen; editor WP & impor/ekspor di tahap Rute.
  let tap = null, limit = null; const io = {};
  if (vp.hasTouch) {
    await step('route');
    const before = await page.locator('#wps .wp').count();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const box = await page.locator('#map').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.85);
    await page.waitForTimeout(300);
    tap = { before, after: await page.locator('#wps .wp').count() };
  } else {
    // Kecepatan per ruas: WP1 → 5 kn memperlambat ETA WP2 (ETA dibaca di tahap Intelijen).
    const etaWp2 = async () => (await page.locator('#tbl tbody tr').nth(1).locator('td').nth(1).textContent());
    const before = await etaWp2();
    await step('route');
    await page.fill('#wps input[data-i="0"][data-f="speed"]', '5');
    await page.locator('#wps input[data-i="0"][data-f="speed"]').dispatchEvent('change');
    await page.waitForTimeout(300);
    await step('intel');
    io.speedChanged = before !== await etaWp2();
    // Kecepatan tak wajar ditolak tanpa mengubah nilai (tahap Rute).
    await step('route');
    await page.fill('#wps input[data-i="1"][data-f="speed"]', '99');
    await page.locator('#wps input[data-i="1"][data-f="speed"]').dispatchEvent('change');
    io.badSpeedRejected = /2–45 knot/.test(await page.locator('#msg').textContent()) && (await page.inputValue('#wps input[data-i="1"][data-f="speed"]')) === '';
    // Ekspor CSV (WP1 kini 5 kn).
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expCsv')]);
    io.exportCsv = fs.readFileSync(await dl.path(), 'utf8');
    // Impor CSV valid (titik koma + koma desimal) lalu CSV dengan duplikat (harus ditolak, rute tetap).
    const tmp = path.join(OUT, 'impor-uji.csv'), bad = path.join(OUT, 'impor-rusak.csv');
    fs.writeFileSync(tmp, 'no;nama;lintang;bujur;kecepatan\n1;Sekupang;1,125;103,925;12\n2;Selat Durian;0,800;103,600;\n3;Pondok Dayung;-6,0958;106,8861;\n');
    fs.writeFileSync(bad, 'lat,lon\n-6.1,106.9\n-6.1,106.9\n');
    await page.setInputFiles('#impFile', tmp);
    await page.waitForTimeout(300);
    io.imported = { wps: await page.locator('#wps .wp').count(), lat2: await page.inputValue('#wps input[data-i="1"][data-k="0"]'), msg: await page.locator('#msg').textContent() };
    await page.setInputFiles('#impFile', bad);
    await page.waitForTimeout(300);
    io.rejected = { wps: await page.locator('#wps .wp').count(), msg: await page.locator('#msg').textContent() };
    for (let i = 0; i < 120; i++) { if (await page.locator('#addWp').isDisabled()) break; await page.click('#addWp'); }
    limit = { wps: await page.locator('#wps .wp').count(), disabled: await page.locator('#addWp').isDisabled(), count: await page.locator('#wpCount').textContent() };
  }
  await ctx.close();

  const checks = [
    ['tidak ada error konsol/halaman', errors.length === 0, errors.join(' | ')],
    ['API /api/forecast 200', apiStatus['/api/forecast'] === 200, String(apiStatus['/api/forecast'])],
    ['API /api/bmkg-warnings 200', apiStatus['/api/bmkg-warnings'] === 200, String(apiStatus['/api/bmkg-warnings'])],
    ['tidak ada pesan galat', !r.msg, r.msg],
    ['jumlah waypoint benar', r.wps === (sc.wps ? sc.wps.length : sc.expect.wps), String(r.wps)],
    ['garis rute berwarna tampil', r.routeColors.length > 0, r.routeColors.join(',')],
    ['status terisi', /AMAN|WASPADA|TIDAK DISARANKAN|TANPA DATA/.test(r.status), r.status],
    ['tabel terisi', r.rows >= 2, String(r.rows)],
    ['jendela berangkat terisi', r.slots.length > 0, String(r.slots.length)],
    ['briefing terisi', r.brief.startsWith('SIGAP LAUT') && /STATUS:/.test(r.brief), r.brief.slice(0, 40)],
    ['peringatan BMKG tampil', /peringatan/i.test(r.bmkg) && !/tidak dapat diambil/.test(r.bmkg), r.bmkg],
    ['tanpa scroll horizontal', !r.hScroll, ''],
    ['peta diperbesar ke rute', r.routePx > 100, String(Math.round(r.routePx)) + ' px'],
    ['tautan pelabuhan BMKG terdekat', sc.expect.ports.every(n => r.ports.includes(n)) && r.portLinks.length === 2 && r.portLinks.every(h => h.startsWith('https://www.bmkg.go.id/cuaca/maritim/pelabuhan/')), r.ports],
    ['peringatan sel grid sama sesuai rute', !hasCells || sc.expect.sharedCell === r.dq.some(t => /sel grid model yang sama/.test(t)), hasCells ? (r.dq.join(' | ') || '(tidak ada)') : 'dilewati: API tanpa data sel grid'],
    ['data tabel = data mentah API (jam tiba, gelombang, angin, arus, status)', acc.checked === r.wps && acc.bad.length === 0, `${acc.checked} WP diperiksa; ` + acc.bad.slice(0, 4).join(' | ')],
    ['briefing tidak menyebut "jendela aman" bila status bukan AMAN', r.status === 'AMAN' || !/Jendela aman terdekat/.test(r.brief), ''],
    ['status per titik terlihat tanpa geser tabel', ux.dotsVisible, ''],
    ['label WP di peta tidak menumpuk (≤ 12 permanen)', ux.labels <= 12, String(ux.labels)],
    ['kolom haluan & jarak ruas terisi per WP', ux.legsOk, ''],
    ['peringatan BMKG dinilai dengan koridor ±10 NM & jam tiba kapal', ux.bmkgCorr && ux.encOk, ''],
    ['tautan BMKG Maritim di status', ux.marLink, ''],
    ['penghitung waypoint tampil', /^\d+\/100 waypoint · ±\d+ NM · \d+\/150 titik prakiraan$/.test(ux.count), ux.count],
    ...(vp.isMobile ? [
      ['HP: semua tombol & isian ≥ 40 px', ux.small.length === 0, ux.small.slice(0, 6).join(', ')],
      ['HP: huruf kolom isian ≥ 16 px (tanpa zoom otomatis)', ux.tinyFont.length === 0, ux.tinyFont.join(', ')],
      ['HP: tap peta menambah satu waypoint', tap && tap.after === tap.before + 1, JSON.stringify(tap)]
    ] : [
      ['kecepatan per ruas mengubah ETA', io.speedChanged === true, ''],
      ['kecepatan ruas tak wajar ditolak, nilai tidak diubah', io.badSpeedRejected === true, ''],
      ['ekspor CSV berisi semua WP (6 desimal, haluan, ETA UTC)', !!io.exportCsv && io.exportCsv.startsWith('seq,name,lat,lon,speed_kn,leg_nm,bearing_deg_true,eta_utc\n1,,1.125000,103.925000,5,') && io.exportCsv.trim().split('\n').length === 31, (io.exportCsv || '').split('\n').slice(0, 2).join(' / ')],
      ['impor CSV valid dimuat (3 WP, koordinat terbaca)', io.imported && io.imported.wps === 3 && /48[.,]00.?N/.test(io.imported.lat2), JSON.stringify(io.imported)],
      ['impor CSV rusak ditolak utuh, rute tidak berubah', io.rejected && io.rejected.wps === 3 && /ditolak/.test(io.rejected.msg) && /duplikat/.test(io.rejected.msg), JSON.stringify(io.rejected)],
      ['batas 100 waypoint ditegakkan', limit && limit.wps === 100 && limit.disabled && limit.count.startsWith('100/100'), JSON.stringify(limit)]
    ]),
    ['briefing memuat kualitas data & pelabuhan', /Prakiraan pelabuhan BMKG/.test(r.brief) && (!sc.expect.sharedCell || !hasCells || /Kualitas data:/.test(r.brief)), ''],
    ['model angin gagal -> tidak pernah AMAN', !r.windFailed || r.status !== 'AMAN', r.status],
    ['pemeriksaan kedangkalan tampil', r.depth.length > 0 && !r.depth.some(t => /sedang berjalan|tidak tersedia/.test(t)), r.depth.join(' | ')],
    ['kedangkalan sesuai sarat', sc.expect.depth === 'r'
      ? r.status === 'TIDAK DISARANKAN' && r.depthBad > 0
      : r.status !== 'AMAN' && r.depthBad === 0 && r.depth.some(t => t.startsWith('Waspada kedangkalan')), `${r.status}, bahaya=${r.depthBad}`],
    ['penanda kedangkalan di peta', r.depthMarkers > 0, String(r.depthMarkers)],
    ['alur pelabuhan dicatat tidak dinilai', r.depth.some(t => t.startsWith('Alur pelabuhan')), ''],
    ['briefing memuat kedalaman & sumbernya', /Kedalaman: /.test(r.brief) && /ETOPO 2022/.test(r.brief) && /Bukan untuk navigasi/.test(r.brief), '']
  ];
  return { sc, vp, r, checks, shot };
}

(async () => {
  // Lewati proxy HTTPS bila lingkungan menetapkannya (mis. sandbox cloud); --no-sandbox untuk CI/root.
  const browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
  let failed = 0;
  const results = [];
  try {
    for (const sc of SCENARIOS) for (const vp of VIEWPORTS.filter(v => !sc.viewports || sc.viewports.includes(v.id))) {
      const res = await run(browser, sc, vp);
      results.push(res);
      console.log(`\n=== ${sc.name} · ${vp.id} ${vp.width}×${vp.height} ===`);
      if (res.r.dq.length) console.log('kualitas data: ' + res.r.dq.join(' | '));
      console.log('pelabuhan: ' + res.r.ports);
      console.log(`status: ${res.r.status} · warna rute: ${res.r.routeColors.join(',')} · baris: ${res.r.rows} · slot: ${res.r.slots.length}`);
      console.log('meta: ' + res.r.meta);
      for (const [n, ok, info] of res.checks) {
        if (!ok) failed++;
        console.log(`${ok ? 'ok    ' : 'GAGAL '} ${n}${!ok && info ? ' — ' + info : ''}`);
      }
      console.log('screenshot: ' + res.shot);
    }
    results.filter(x => x.vp.id === 'desktop').forEach(b => {
      console.log(`\n--- status ${b.sc.name} ---\n` + b.r.statusText);
      console.log('slot 24 jam pertama: ' + b.r.slots.slice(0, 8).join(' '));
      console.log(`\n--- briefing ${b.sc.name} ---\n` + b.r.brief);
    });
  } finally { await browser.close(); }
  console.log(`\n${failed ? failed + ' pemeriksaan GAGAL' : 'Semua pemeriksaan lulus'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
