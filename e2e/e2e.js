// Uji end-to-end di browser sungguhan (Chromium via Playwright), data live.
// Jalankan: npm run test:e2e            (default: https://sigap-laut.vercel.app)
//           BASE_URL=http://localhost:3000 npm run test:e2e
// Butuh Playwright terpasang (require('playwright')) dan akses jaringan ke situs,
// Open-Meteo, BMKG, unpkg.com dan tile.openstreetmap.org.
const { chromium } = require('playwright');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'https://sigap-laut.vercel.app';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const SCENARIOS = [
  // Rute uji tunggal: Batam (Sekupang) → Jakarta (Tanjung Priok / Pondok Dayung), contoh rute pertama di aplikasi.
  {
    id: 'batam-jakarta-sarat4',
    name: 'Batam → Jakarta, sarat 4 m',
    ship: { sName: 'KRI Uji Sarat 4', sSpeed: '15', sHs: '2.5', sCur: '2', sWind: '30', sDraft: '4', sRange: '3000' },
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
  page.on('response', r => { const u = r.url(); if (u.includes('/api/')) apiStatus[new URL(u).pathname] = r.status(); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.leaflet-container .leaflet-tile-loaded', { timeout: 30000 });

  // data kapal
  for (const [id, v] of Object.entries(sc.ship)) await page.fill('#' + id, v);
  await page.click('#shipForm button[type=submit]');
  await page.waitForSelector('#shipView:not([hidden])');

  // rute
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

  await page.click('#calc');
  await page.waitForFunction(() => document.querySelector('#calc').textContent.includes('Hitung') && !document.querySelector('#calc').disabled, null, { timeout: 60000 });
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
      portLinks: [...document.querySelectorAll('#status .note.port a')].map(a => a.href),
      routePx: (() => { const bs = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter(p => ['#16a05a', '#e2a100', '#d33f3f', '#9aa7b6'].includes(p.getAttribute('stroke'))).map(p => p.getBoundingClientRect());
        if (!bs.length) return 0; return Math.max(Math.max(...bs.map(b => b.right)) - Math.min(...bs.map(b => b.left)), Math.max(...bs.map(b => b.bottom)) - Math.min(...bs.map(b => b.top))); })(),
      windFailed: /model angin gagal/.test(document.querySelector('#status').innerText),
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });

  const shot = path.join(OUT, `${sc.id}-${vp.id}.png`);
  await page.screenshot({ path: shot, fullPage: vp.id === 'hp' });
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
    ['peringatan sel grid sama sesuai rute', sc.expect.sharedCell === r.dq.some(t => /sel grid model yang sama/.test(t)), r.dq.join(' | ') || '(tidak ada)'],
    ['briefing memuat kualitas data & pelabuhan', /Prakiraan pelabuhan BMKG/.test(r.brief) && (!sc.expect.sharedCell || /Kualitas data:/.test(r.brief)), ''],
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
  const browser = await chromium.launch();
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
