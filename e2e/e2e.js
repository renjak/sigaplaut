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
  {
    id: 'batam',
    name: 'Tanjung Uban → Telaga Punggur',
    ship: { sName: 'KRI Uji Batam', sSpeed: '10', sHs: '1.5', sCur: '2', sWind: '25', sDraft: '2.5' },
    wps: [['1.0652', '104.2163'], ['1.070', '104.180'], ['1.058', '104.145']]
  },
  {
    id: 'kupang',
    name: 'Surabaya → Kupang',
    ship: { sName: 'KRI Uji Kupang', sSpeed: '14', sHs: '3.5', sLoa: '90', sRange: '3000', sWind: '35' },
    preset: '0'
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
    ['jumlah waypoint benar', r.wps === (sc.wps ? sc.wps.length : 7), String(r.wps)],
    ['garis rute berwarna tampil', r.routeColors.length > 0, r.routeColors.join(',')],
    ['status terisi', /AMAN|WASPADA|TIDAK DISARANKAN|TANPA DATA/.test(r.status), r.status],
    ['tabel terisi', r.rows >= 2, String(r.rows)],
    ['jendela berangkat terisi', r.slots.length > 0, String(r.slots.length)],
    ['briefing terisi', r.brief.startsWith('SIGAP LAUT') && /STATUS:/.test(r.brief), r.brief.slice(0, 40)],
    ['peringatan BMKG tampil', /peringatan/i.test(r.bmkg) && !/tidak dapat diambil/.test(r.bmkg), r.bmkg],
    ['tanpa scroll horizontal', !r.hScroll, '']
  ];
  return { sc, vp, r, checks, shot };
}

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  const results = [];
  try {
    for (const sc of SCENARIOS) for (const vp of VIEWPORTS) {
      const res = await run(browser, sc, vp);
      results.push(res);
      console.log(`\n=== ${sc.name} · ${vp.id} ${vp.width}×${vp.height} ===`);
      console.log(`status: ${res.r.status} · warna rute: ${res.r.routeColors.join(',')} · baris: ${res.r.rows} · slot: ${res.r.slots.length}`);
      console.log('meta: ' + res.r.meta);
      for (const [n, ok, info] of res.checks) {
        if (!ok) failed++;
        console.log(`${ok ? 'ok    ' : 'GAGAL '} ${n}${!ok && info ? ' — ' + info : ''}`);
      }
      console.log('screenshot: ' + res.shot);
    }
    const b = results.find(x => x.sc.id === 'batam' && x.vp.id === 'desktop');
    if (b) {
      console.log('\n--- status Batam ---\n' + b.r.statusText);
      console.log('slot 24 jam pertama: ' + b.r.slots.slice(0, 8).join(' '));
      console.log('\n--- briefing Batam ---\n' + b.r.brief);
    }
  } finally { await browser.close(); }
  console.log(`\n${failed ? failed + ' pemeriksaan GAGAL' : 'Semua pemeriksaan lulus'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
