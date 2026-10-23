// Vercel Edge Function: teacher absences for a day.
//   GET  /api/absences?date=YYYY-MM-DD          → { date, items:[{ t, p:[periods], note }], updatedAt }   (public)
//   POST /api/absences  { date, items }          → saves the day's list                                (admin only)
//   POST /api/absences  { check:true }           → checks the admin password
// Setup in Vercel → Project:
//   1. Storage → Marketplace → "Upstash for Redis" (free) → connect it to this project
//      (it adds KV_REST_API_URL and KV_REST_API_TOKEN by itself).
//   2. Settings → Environment Variables → ADMIN_PASSWORD = a long password only the admins know. Redeploy.
export const config = { runtime: "edge" };

const okOrigin = o => !o || o === "https://7o-epal-project.vercel.app" || /^https:\/\/7o-epal-project[-a-z0-9]*\.vercel\.app$/.test(o);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_SECONDS = 60 * 60 * 24 * 30; // a day's list is kept for 30 days

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("storage-not-set-up");
  const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "storage-error");
  return j.result;
}
function sameText(a, b) { // constant-time comparison
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
const clean = items => (Array.isArray(items) ? items : []).slice(0, 80).map(it => ({
  t: String((it && it.t) || "").replace(/\s+/g, " ").trim().slice(0, 80),
  p: [...new Set((Array.isArray(it && it.p) ? it.p : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 9))].sort((a, b) => a - b),
  note: String((it && it.note) || "").replace(/\s+/g, " ").trim().slice(0, 140)
})).filter(it => it.t);

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  const cors = { "Access-Control-Allow-Origin": okOrigin(origin) && origin ? origin : "https://7o-epal-project.vercel.app", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Vary": "Origin" };
  const json = (status, data, extra) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", ...(extra || {}) } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    if (req.method === "GET") {
      const date = new URL(req.url).searchParams.get("date") || "";
      if (!DAY.test(date)) return json(400, { error: "bad date" });
      const raw = await redis(["GET", "abs7:" + date]);
      const data = raw ? JSON.parse(raw) : { date, items: [], updatedAt: 0 };
      return json(200, data, { "Cache-Control": "public, max-age=0, s-maxage=20, stale-while-revalidate=60" });
    }
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });
    if (!okOrigin(origin)) return json(403, { error: "Forbidden" });
    const pass = process.env.ADMIN_PASSWORD || "";
    if (pass.length < 8) return json(500, { error: "ADMIN_PASSWORD is not set on the server" });
    const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!sameText(given, pass)) { await new Promise(r => setTimeout(r, 900)); return json(401, { error: "wrong password" }); }
    let body; try { body = JSON.parse(await req.text()); } catch { return json(400, { error: "Bad request" }); }
    if (body && body.check) return json(200, { ok: true });
    if (!body || !DAY.test(body.date || "")) return json(400, { error: "bad date" });
    const data = { date: body.date, items: clean(body.items), updatedAt: Date.now() };
    if (data.items.length) await redis(["SET", "abs7:" + data.date, JSON.stringify(data), "EX", KEEP_SECONDS]);
    else await redis(["DEL", "abs7:" + data.date]);
    return json(200, data);
  } catch (e) {
    return json(e && e.message === "storage-not-set-up" ? 503 : 500, { error: (e && e.message) || "error" });
  }
}
