// Spotlog proxy voor Vercel: haalt live vliegtuigdata op en geeft die door aan de app.
// Gebruik: /api/proxy?url=<bron>   Controle van alle bronnen: /api/proxy?test=1
const ALLOW = ["api.adsb.lol", "opendata.adsb.fi", "api.airplanes.live", "api.adsb.one",
  "opensky-network.org", "api.adsbdb.com", "api.planespotters.net"];
const CONTACT = "jordi.kich1996@gmail.com";
const HEADERS = { "User-Agent": "Spotlog/1.0 (hobby plane-spotting app; +" + CONTACT + ")", "Accept": "application/json" };

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (type) res.setHeader("Content-Type", type);
  res.end(body);
}

async function get(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 25000);
  try { return await fetch(url, { headers: HEADERS, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function test(res) {
  const p = "52.3086/4.7639/25";
  const targets = {
    "adsb.lol": "https://api.adsb.lol/v2/point/" + p,
    "adsb.fi": "https://opendata.adsb.fi/api/v2/lat/52.3086/lon/4.7639/dist/25",
    "airplanes.live": "https://api.airplanes.live/v2/point/" + p,
    "adsb.one": "https://api.adsb.one/v2/point/" + p,
    "OpenSky": "https://opensky-network.org/api/states/all?lamin=51.9&lomin=4.1&lamax=52.7&lomax=5.4",
    "adsbdb": "https://api.adsbdb.com/v0/aircraft/PH-BXA",
    "planespotters": "https://api.planespotters.net/pub/photos/reg/PH-BXA"
  };
  const out = { host: "vercel", versie: 2, regio: process.env.VERCEL_REGION || "?", node: process.version };
  await Promise.all(Object.keys(targets).map(async (name) => {
    const t0 = Date.now();
    try {
      const r = await get(targets[name], 20000);
      const body = await r.text();
      out[name] = { status: r.status, ms: Date.now() - t0, begin: body.slice(0, 120) };
    } catch (e) { out[name] = { error: String((e && e.name) || e), ms: Date.now() - t0 }; }
  }));
  send(res, 200, JSON.stringify(out, null, 2), "application/json; charset=utf-8");
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    const q = new URL(req.url, "https://localhost").searchParams;
    if (q.get("test")) return await test(res);
    let target;
    try { target = new URL(q.get("url")); }
    catch (e) { return send(res, 200, "Spotlog proxy (Vercel) werkt. Open ?test=1 voor een controle van alle bronnen.", "text/plain; charset=utf-8"); }
    if (target.protocol !== "https:" || ALLOW.indexOf(target.hostname) === -1)
      return send(res, 403, "Deze bron is niet toegestaan", "text/plain; charset=utf-8");
    const r = await get(target.toString(), 25000);
    const body = Buffer.from(await r.arrayBuffer());
    res.setHeader("Cache-Control", "public, s-maxage=4, max-age=0");
    send(res, r.status, body, r.headers.get("content-type") || "application/json");
  } catch (e) {
    send(res, 502, "Spotlog proxy fout: " + String((e && e.stack) || e), "text/plain; charset=utf-8");
  }
};

