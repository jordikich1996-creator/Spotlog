// Spotlog synchronisatie: bewaart je logboek en foto's privé in Vercel Blob,
// zodat telefoon en pc hetzelfde logboek hebben.
//   GET  /api/sync?op=pull                 -> logboek ophalen
//   POST /api/sync?op=push                 -> logboek opslaan (met etag tegen overschrijven)
//   PUT  /api/sync?op=photo&id=<id>        -> foto opslaan
//   GET  /api/sync?op=photo&id=<id>        -> foto ophalen
//   GET  /api/sync?op=status               -> werkt de opslag?
// Elke aanvraag heeft de header x-sync-code nodig; alleen wie die code kent, ziet het logboek.
const crypto = require("crypto");
const { put, get, BlobPreconditionFailedError } = require("@vercel/blob");

const MAX_DOC = 4 * 1024 * 1024, MAX_PHOTO = 4 * 1024 * 1024;

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  if (type) res.setHeader("Content-Type", type);
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");

async function readBody(req, max) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("te groot"), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readBlob(pathname) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { buf: Buffer.from(await new Response(r.stream).arrayBuffer()), etag: r.blob.etag, type: r.blob.contentType };
}

module.exports = async function handler(req, res) {
  try {
    const q = new URL(req.url, "https://localhost").searchParams;
    const op = q.get("op");
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID)
      return json(res, 503, { fout: "Geen opslag gekoppeld. Maak in Vercel bij Storage een Blob-opslag aan en koppel die aan dit project." });

    const code = String(req.headers["x-sync-code"] || "");
    if (!/^[A-Za-z0-9-]{20,80}$/.test(code)) return json(res, 401, { fout: "ongeldige synchronisatiecode" });
    const space = "spotlog/" + crypto.createHash("sha256").update(code).digest("hex").slice(0, 40);
    const docPath = space + "/logboek.json";

    if (op === "status") return json(res, 200, { ok: true });

    if (op === "pull" && req.method === "GET") {
      const b = await readBlob(docPath);
      if (!b) return json(res, 200, { doc: null, etag: null });
      return json(res, 200, { doc: JSON.parse(b.buf.toString("utf8")), etag: b.etag });
    }

    if (op === "push" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, MAX_DOC)).toString("utf8"));
      if (!body || !body.doc || !Array.isArray(body.doc.spots)) return json(res, 400, { fout: "ongeldig logboek" });
      try {
        const r = await put(docPath, JSON.stringify(body.doc), {
          access: "private", addRandomSuffix: false, contentType: "application/json",
          cacheControlMaxAge: 60, ...(body.etag ? { ifMatch: body.etag } : { allowOverwrite: !!body.force })
        });
        return json(res, 200, { ok: true, etag: r.etag });
      } catch (e) {
        if (e instanceof BlobPreconditionFailedError || /precondition|already exists/i.test(String(e && e.message)))
          return json(res, 409, { fout: "intussen gewijzigd" });
        throw e;
      }
    }

    if (op === "photo") {
      const id = q.get("id") || "";
      if (!/^[a-z0-9]{6,40}$/.test(id)) return json(res, 400, { fout: "ongeldige foto" });
      const p = space + "/fotos/" + id + ".jpg";
      if (req.method === "PUT") {
        const buf = await readBody(req, MAX_PHOTO);
        if (!buf.length) return json(res, 400, { fout: "lege foto" });
        await put(p, buf, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET") {
        const b = await readBlob(p);
        if (!b) return json(res, 404, { fout: "foto niet gevonden" });
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.statusCode = 200; res.setHeader("Content-Type", b.type || "image/jpeg"); return res.end(b.buf);
      }
    }
    return json(res, 400, { fout: "onbekende opdracht" });
  } catch (e) {
    return json(res, e && e.code === 413 ? 413 : 500, { fout: String((e && e.message) || e) });
  }
};
