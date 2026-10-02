js
// Spotlog proxy voor Vercel: haalt live vliegtuigdata op en geeft die door aan de app.
// Gebruik: /api/proxy?url=<bron>   Controle van alle bronnen: /api/proxy?test=1
const ALLOW = ["api.adsb.lol", "opendata.adsb.fi", "api.airplanes.live", "api.adsb.one",
  "opensky-network.org", "api.adsbdb.com", "api.planespotters.net"];
const CONTACT = "jordi.kich1996@gmail.com";
const HEADERS = { "User-Agent": `Spotlog/1.0 (hobby plane-spotting app; +${CONTACT})`, "Accept": "application/json" };

async function get(url, ms = 25000) {
  return fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(ms) });
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
  const out = { host: "vercel", regio: process.env.VERCEL_REGION || "?" };
  await Promise.all(Object.entries(targets).map(async ([name, url]) => {
    const t0 = Date.now();
    try { const r = await get(url); const body = await r.text(); out[name] = { status: r.status, ms: Date.now() - t0, begin: body.slice(0, 120) }; }
    catch (e) { out[name] = { error: String(e.name || e), ms: Date.now() - t0 }; }
  }));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).send(JSON.stringify(out, null, 2));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.query.test) return test(res);
  let target;
  try { target = new URL(req.query.url); }
  catch { return res.status(200).send("Spotlog proxy (Vercel) werkt. Open ?test=1 voor een controle van alle bronnen."); }
  if (target.protocol !== "https:" || !ALLOW.includes(target.hostname)) return res.status(403).send("Deze bron is niet toegestaan");
  try {
    const r = await get(target.toString());
    const body = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "public, s-maxage=4, max-age=0");
    return res.status(r.status).send(body);
  } catch (e) {
    return res.status(504).send("Bron reageerde niet: " + (e.name || e));
  }
}
