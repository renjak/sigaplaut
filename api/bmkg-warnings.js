// Peringatan dini cuaca BMKG (format CAP, domain publik) - yang masih berlaku.
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; sigap-laut/0.2)' };
const RSS = 'https://www.bmkg.go.id/alerts/nowcast/id/rss.xml';
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tag = (s, t) => { const m = s.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? dec(m[1].trim()) : ''; };

module.exports = async (req, res) => {
  try {
    const r = await fetch(RSS, { headers: H, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('RSS ' + r.status);
    const rss = await r.text();
    const links = [...new Set([...rss.matchAll(/<link>(https:\/\/www\.bmkg\.go\.id\/alerts\/nowcast\/id\/[A-Za-z0-9_]+_alert\.xml)<\/link>/g)].map(m => m[1]))].slice(0, 80);
    const now = Date.now();
    const caps = await Promise.allSettled(links.map(async u => {
      const x = await fetch(u, { headers: H, signal: AbortSignal.timeout(10000) });
      if (!x.ok) throw new Error(String(x.status));
      return [u, await x.text()];
    }));
    const alerts = [];
    for (const c of caps) {
      if (c.status !== 'fulfilled') continue;
      const [url, xml] = c.value;
      const info = tag(xml, 'info');
      const expires = Date.parse(tag(info, 'expires')) || null;
      if (expires && expires < now) continue;
      const polys = [...info.matchAll(/<polygon>([\s\S]*?)<\/polygon>/g)].map(m => {
        let pts = m[1].trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
        const step = Math.ceil(pts.length / 80);
        if (step > 1) pts = pts.filter((_, i) => i % step === 0);
        return pts.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
      }).filter(p => p.length >= 3);
      alerts.push({
        url, event: tag(info, 'event'), headline: tag(info, 'headline'), severity: tag(info, 'severity'),
        effective: Date.parse(tag(info, 'effective')) || null, expires, area: tag(info, 'areaDesc'), polys
      });
    }
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json({ source: 'BMKG – Peringatan Dini Cuaca (CAP)', fetchedAt: now, count: alerts.length, alerts });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal mengambil peringatan dini BMKG.', detail: String(e).slice(0, 200) });
  }
};
